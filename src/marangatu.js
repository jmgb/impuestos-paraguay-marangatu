import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import dotenv from "dotenv";
import { chromium } from "playwright";

import {
  booleanValue,
  displayPeriod,
  forms,
  matchesPresentedDeclaration,
  monthLabels,
  notificationPolicy,
  parseArgs,
  periodStateKey,
  redactSessionUrls,
  resolveRunMode,
  targetPeriod
} from "./core.js";
import { sendPresentationConfirmation } from "./email-notifier.js";
import {
  emailStateFile,
  rootDir,
  runFormWithStateTracking,
  setFormStatus
} from "./state.js";
import { buildResultSummary, sendTelegramMessage } from "./telegram.js";

// El .env se busca junto al proyecto, no en el directorio de trabajo.
dotenv.config({ path: path.join(rootDir, ".env"), quiet: true });

const artifactsDir = path.resolve(rootDir, process.env.MARANGATU_ARTIFACTS_DIR || "artifacts");
const presentacionesDir = path.resolve(rootDir, process.env.MARANGATU_PRESENTACIONES_DIR || "presentaciones");

const baseUrl = "https://marangatu.set.gov.py/eset/";
const loginUrl = `${baseUrl}login`;
const f241GestionPath = "gestionComprobantesVirtuales.do";
const f241TalonPath = "gdi/presentacionTalonResumen.do";
const f241GestionOption = "Gestion De Comprobantes Informativos";
const f241GestionHeading = /Gesti.n de Comprobantes/;
const noPendingTalons = "No existen talones pendientes de presentación";

function env(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === "") {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// Nunca lanza: un checkpoint de depuración no debe interrumpir una
// presentación a medias.
async function checkpoint(page, name) {
  const png = path.join(artifactsDir, `${name}.png`);
  const html = path.join(artifactsDir, `${name}.html`);
  const saved = async write => write().then(() => true, () => false);
  await fs.mkdir(artifactsDir, { recursive: true }).catch(() => {});
  if (await saved(() => page.screenshot({ path: png, fullPage: true }))) {
    console.log(`Screenshot: ${png}`);
  }
  if (await saved(async () => fs.writeFile(html, redactSessionUrls(await page.content()), "utf8"))) {
    console.log(`HTML: ${html}`);
  }
}

// Ante un error, captura todas las pestañas abiertas: el fallo puede estar en
// una ventana emergente del portal y no en la página principal.
async function checkpointOpenPages(context, name) {
  for (const [index, page] of context.pages().entries()) {
    await checkpoint(page, `${name}-${index + 1}`);
  }
}

// Guarda el documento presentado en presentaciones/YYYY-MM/ como PNG, HTML
// (sin URLs de sesión) y PDF. Chromium solo genera PDF en modo headless.
async function saveJustificante(page, period, name) {
  const periodDir = path.join(presentacionesDir, periodStateKey(period));
  await fs.mkdir(periodDir, { recursive: true });
  const filePath = path.join(periodDir, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  await fs.writeFile(path.join(periodDir, `${name}.html`), redactSessionUrls(await page.content()), "utf8");
  await page.pdf({ path: path.join(periodDir, `${name}.pdf`), printBackground: true }).catch(error => {
    console.log(`PDF de ${name} no generado: ${error.message.split("\n")[0]}`);
  });
  console.log(`Justificante guardado: ${path.join(periodDir, name)}.{png,html,pdf}`);
  return filePath;
}

async function showSubmitDisabledAlert(page, formName, detail) {
  const message = [
    `${formName}: modo presentacion desactivado.`,
    "MARANGATU_SUBMIT=false o falta --submit.",
    detail
  ].filter(Boolean).join("\n");

  page.once("dialog", async dialog => {
    console.log(`Alert shown: ${dialog.message()}`);
    await dialog.accept();
  });
  await page.evaluate(alertMessage => window.alert(alertMessage), message);
}

async function waitForMarangatu(page) {
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1200);
}

async function openHome(page) {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await waitForMarangatu(page);
}

async function login(page) {
  console.log("Opening Marangatu login.");
  await page.goto(loginUrl, { waitUntil: "domcontentloaded" });

  await page.locator("#usuario").fill(env("MARANGATU_USER"));
  await page.locator('input[type="password"]').fill(env("MARANGATU_PASSWORD"));
  await checkpoint(page, "01-login-filled");

  await page.getByRole("button", { name: "Acceder", exact: true }).click();
  await waitForMarangatu(page);

  try {
    const userName = env("MARANGATU_EXPECTED_NAME", "");
    if (userName) {
      await page.getByRole("link", { name: userName, exact: true }).waitFor({ state: "visible", timeout: 20000 });
    }
    await page.locator('input[name="busqueda"], input[placeholder*="men"]').waitFor({ state: "visible", timeout: 20000 });
  } catch (error) {
    throw new Error(`Login no completado: revise credenciales, MARANGATU_EXPECTED_NAME o si el portal pide CAPTCHA/verificación adicional (${error.message.split("\n")[0]}).`);
  }

  await checkpoint(page, "02-home-after-login");
  console.log("Login completed.");
}

async function findCommonOptionHref(page, optionName) {
  await openHome(page);
  const link = page.getByRole("link", { name: optionName });
  await link.waitFor({ state: "visible", timeout: 30000 });
  const href = await link.getAttribute("href");
  if (!href || href === "#") {
    throw new Error(`Common option has no direct href: ${optionName}`);
  }
  return new URL(href, baseUrl).toString();
}

function findMarangatuUrlInHtml(html, pathFragment) {
  const escapedPath = pathFragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`(?:/eset/)?${escapedPath}\\?_cyp=[^"'\\s<>]+`));
  if (!match) return undefined;
  return new URL(match[0].replace(/^\/eset\//, ""), baseUrl).toString();
}

async function openPresentDeclaration(page) {
  const href = await findCommonOptionHref(page, /^\s*Presentar Declaraci.n\s*$/);
  console.log("Opening Presentar Declaracion via portal session URL (redacted).");
  await page.goto(href, { waitUntil: "domcontentloaded" });
  await waitForMarangatu(page);
  await page.getByRole("heading", { name: /Presentar Declaraci.n/ }).waitFor({ state: "visible", timeout: 20000 });
}

async function selectByVisibleOption(page, optionText, ordinal = 0) {
  const select = page.locator("select").filter({
    has: page.locator("option", { hasText: optionText })
  }).nth(ordinal);
  await select.waitFor({ state: "visible", timeout: 20000 });
  await select.selectOption({ label: optionText });
}

async function safeClick(page, locator, label) {
  await locator.waitFor({ state: "visible", timeout: 20000 });
  const disabled = await locator.getAttribute("disabled").catch(() => null);
  if (disabled !== null) {
    throw new Error(`Button is disabled: ${label}`);
  }
  await locator.click();
  await waitForMarangatu(page);
}

async function findMenuApplicationUrl(page, description) {
  return page.evaluate(expectedDescription => {
    const root = document.querySelector('[data-ng-controller="MenuController as vm"]');
    const vm = window.angular?.element(root)?.scope()?.vm;
    const seen = new Set();

    function find(value) {
      if (!value || typeof value !== "object" || seen.has(value)) return undefined;
      seen.add(value);
      if (value.descripcion === expectedDescription) return value;
      for (const child of Object.values(value)) {
        const found = find(child);
        if (found) return found;
      }
      return undefined;
    }

    return find(vm?.datos?.menu)?.url || "";
  }, description);
}

async function openConsultarDeclaraciones(page) {
  await openHome(page);
  const category = page.getByText(/Declaraciones Juradas [Yy] Pagos/, { exact: true }).first();
  await category.waitFor({ state: "visible", timeout: 20000 });
  await category.click();
  await page.waitForTimeout(1000);

  const option = page.getByText("Consultar Declaraciones", { exact: true }).first();
  await option.waitFor({ state: "visible", timeout: 20000 });
  const dynamicUrl = await findMenuApplicationUrl(page, "Consultar Declaraciones");
  if (dynamicUrl) {
    console.log("Opening Consultar Declaraciones via portal session URL (redacted).");
    await page.goto(new URL(dynamicUrl, page.url()).href, { waitUntil: "domcontentloaded" });
  } else {
    await option.locator("xpath=../..").click();
  }
  await waitForMarangatu(page);
  await page.getByRole("heading", { name: /CONSULTAR DECLARACIONES/i })
    .waitFor({ state: "visible", timeout: 20000 });
}

async function consultFormulario120Presented(page, period, checkpointName) {
  await openConsultarDeclaraciones(page);
  await page.locator('select[name="formulario"]').selectOption({ label: "120 - IVA GENERAL" });
  await page.locator('input[name="periodo"]').fill(displayPeriod(period));
  await page.locator('input[name="periodoHasta"]').fill(displayPeriod(period));
  await page.locator('button[data-ng-click*="consultar"]').first().click();

  const table = page.locator("table").first();
  const noRecords = page.getByText("No se encontraron registros para la búsqueda", { exact: false }).first();
  await Promise.race([
    table.waitFor({ state: "visible", timeout: 30000 }),
    noRecords.waitFor({ state: "visible", timeout: 30000 })
  ]).catch(() => {});
  await waitForMarangatu(page);
  if (checkpointName) await checkpoint(page, checkpointName);
  if (await noRecords.isVisible().catch(() => false)) return false;
  if (!await table.isVisible().catch(() => false)) {
    throw new Error("Consultar Declaraciones no devolvió tabla ni mensaje de ausencia de registros.");
  }

  const rows = await table.evaluate(element => {
    const headers = [...element.querySelectorAll("th")].map(header => header.innerText.trim());
    const index = label => headers.findIndex(header => header === label);
    const indexes = {
      periodo: index("Periodo"),
      estado: index("Estado"),
      formulario: index("Formulario"),
      activa: index("Estado Activa")
    };
    return [...element.querySelectorAll("tbody tr")].map(row => {
      const cells = [...row.querySelectorAll("td")].map(cell => cell.innerText.trim());
      return Object.fromEntries(Object.entries(indexes).map(([key, cellIndex]) => [
        key,
        cellIndex >= 0 ? cells[cellIndex] : ""
      ]));
    });
  });
  return rows.some(row => matchesPresentedDeclaration(row, period, "120"));
}

async function verifyFormulario120Presented(page, period, checkpointName) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await consultFormulario120Presented(page, period, checkpointName)) return true;
    await page.waitForTimeout(3000);
  }
  return false;
}

// Abre desde Consultar Declaraciones la "Declaración Jurada Original" del
// periodo (pestaña nueva) y la guarda en presentaciones/YYYY-MM/.
async function saveFormulario120Declaracion(page, period) {
  if (!await consultFormulario120Presented(page, period)) {
    throw new Error(`F120 ${displayPeriod(period)} no aparece en Consultar Declaraciones.`);
  }
  const row = page.locator("table tbody tr").filter({ hasText: displayPeriod(period) }).first();
  const [detail] = await Promise.all([
    page.context().waitForEvent("page", { timeout: 20000 }),
    row.getByText("Consultar", { exact: true }).click()
  ]);
  try {
    await detail.locator("h4").filter({ hasText: /DECLARACI.N JURADA\s+ORIGINAL/ }).first()
      .waitFor({ state: "attached", timeout: 30000 });
    await waitForMarangatu(detail);
    return await saveJustificante(detail, period, "F120-declaracion");
  } finally {
    await detail.close().catch(() => {});
  }
}

async function waitForFormulario120Submission(page) {
  const sending = page.getByText("Enviando declaración", { exact: true }).first();
  const appeared = await sending
    .waitFor({ state: "visible", timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  if (appeared) {
    await sending.waitFor({ state: "hidden", timeout: 120000 });
  }
  await waitForMarangatu(page);
}

async function prepareFormulario120(page, period, submit, force = false) {
  const alreadyPresented = await consultFormulario120Presented(page, period, "03-f120-consult-before");
  // --force solo llega aquí en dry-run: resolveRunMode lo rechaza con --submit.
  if (alreadyPresented && !force) {
    console.log(`F120 appears in Ultimas Declaraciones for ${displayPeriod(period)}. Skipping duplicate preparation.`);
    await checkpoint(page, "03-f120-already-presented");
    return { status: "ya presentado en portal", stateStatus: "presentado" };
  }

  if (alreadyPresented) {
    console.log(`F120 ${displayPeriod(period)} is already presented; forcing dry-run UI verification without submission.`);
  }

  console.log(`Preparing F120 for ${displayPeriod(period)}.`);
  await openPresentDeclaration(page);

  await selectByVisibleOption(page, "211 - IVA General - MENSUAL");
  await selectByVisibleOption(page, String(period.year));
  await selectByVisibleOption(page, monthLabels[period.month - 1]);
  await checkpoint(page, "03-f120-period-selected");

  await safeClick(page, page.getByRole("button", { name: /Abrir Declaraci.n/ }), "Abrir Declaracion");
  await checkpoint(page, "04-f120-opened");

  if (!submit) {
    await showSubmitDisabledAlert(page, "F120", "El script se detuvo antes de pulsar Presentar Declaracion.");
    console.log("F120 stopped before final submission because submit mode is off.");
    return { status: "preparado hasta Presentar Declaración" };
  }

  await safeClick(page, page.getByRole("button", { name: /Presentar Declaraci.n/ }), "Presentar Declaracion");
  const confirm = page
    .locator(".modal-dialog:visible")
    .getByRole("button", { name: /^\s*(Confirmar|Aceptar|Presentar(?: Declaraci.n)?)\s*$/i })
    .first();
  if (await confirm.waitFor({ state: "visible", timeout: 10000 }).then(() => true).catch(() => false)) {
    await checkpoint(page, "05-f120-confirmation-ready");
    await safeClick(page, confirm, "Confirmar F120");
  }
  await waitForFormulario120Submission(page);
  await checkpoint(page, "05-f120-submit-response");
  const resultAccept = page
    .locator(".modal-dialog:visible")
    .getByRole("button", { name: /^\s*Aceptar\s*$/i })
    .first();
  if (await resultAccept.waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false)) {
    await resultAccept.click();
    await page.waitForTimeout(800);
  }
  await saveJustificante(page, period, "F120-resultado").catch(error => {
    console.log(`No se pudo guardar el resultado F120: ${error.message}`);
  });
  if (!await verifyFormulario120Presented(page, period, "05-f120-consult-after-submit")) {
    throw new Error(`F120: no aparece como declaración presentada y activa en Consultar Declaraciones para ${displayPeriod(period)}.`);
  }
  await checkpoint(page, "05-f120-submitted-verified");
  const justificante = await saveFormulario120Declaracion(page, period).catch(error => {
    console.log(`No se pudo guardar la declaración F120: ${error.message}`);
    return undefined;
  });
  return { status: "presentado", justificante };
}

async function prepareFormulario241(page, period, submit) {
  console.log(`Preparing F241 talon presentation for ${displayPeriod(period)}.`);
  const gestionPage = await openFormulario241Gestion(page);
  await checkpoint(gestionPage, "06-f241-gestion");

  const talonPage = await openFormulario241Talon(gestionPage);
  await checkpoint(talonPage, "07-f241-talon-opened");

  await selectFormulario241Period(talonPage, period);
  await checkpoint(talonPage, "08-f241-period-selected");

  if (await talonPage.getByText(noPendingTalons, { exact: false }).isVisible().catch(() => false)) {
    console.log(`F241 has no pending talons for ${displayPeriod(period)}.`);
    return { status: "sin pendientes", stateStatus: "sin-pendientes" };
  }

  const submitButton = talonPage
    .locator('button[data-ng-click^="vm.procesar"]')
    .filter({ hasText: /Presentar\s+declaraci.n/i })
    .first();
  await submitButton.waitFor({ state: "visible", timeout: 30000 });
  await checkpoint(talonPage, "09-f241-submit-ready");

  if (!submit) {
    await showSubmitDisabledAlert(talonPage, "F241", "Hay talones pendientes, pero el script se detuvo antes de confirmar la presentacion.");
    console.log("F241 stopped before final confirmation because submit mode is off.");
    return { status: "talones pendientes; preparado hasta Confirmar presentación" };
  }

  await safeClick(talonPage, submitButton, "Presentar declaracion F241");
  await checkpoint(talonPage, "10-f241-submit-clicked");

  const popupAccept = talonPage
    .locator('button.btn-primary[type="button"]')
    .filter({ hasText: /^\s*Aceptar\s*$/i })
    .first();
  await popupAccept.waitFor({ state: "visible", timeout: 20000 });
  await safeClick(talonPage, popupAccept, "Aceptar popup F241");
  await checkpoint(talonPage, "11-f241-popup-accepted");
  await saveJustificante(talonPage, period, "F241-resultado").catch(error => {
    console.log(`No se pudo guardar el resultado F241: ${error.message}`);
  });
  // El portal reutiliza la ventana del talón si sigue abierta y no emite popup.
  if (talonPage !== gestionPage) await talonPage.close().catch(() => {});

  const verificationGestionPage = await openFormulario241Gestion(gestionPage);
  const verificationPage = await openFormulario241Talon(verificationGestionPage);
  await selectFormulario241Period(verificationPage, period);
  const noPending = await verificationPage
    .getByText(noPendingTalons, { exact: false })
    .isVisible()
    .catch(() => false);
  await checkpoint(verificationPage, "12-f241-submitted-verified");
  if (!noPending) {
    throw new Error(`F241: el portal aún muestra talones pendientes para ${displayPeriod(period)} tras confirmar.`);
  }

  const justificante = await saveFormulario241Talon(verificationPage, period).catch(error => {
    console.log(`No se pudo guardar el talón F241: ${error.message}`);
    return undefined;
  });
  return { status: "presentado", justificante };
}

// Abre desde el talón la "Consulta de Declaraciones Informativas", busca el
// 241 del periodo y guarda su detalle en presentaciones/YYYY-MM/.
async function saveFormulario241Talon(talonPage, period) {
  const context = talonPage.context();
  const [consulta] = await Promise.all([
    context.waitForEvent("page", { timeout: 20000 }),
    talonPage.getByText("Consulta de Declaraciones Informativas", { exact: true }).click()
  ]);
  try {
    const formSelect = consulta.locator('select[name="estado"]');
    await formSelect.waitFor({ state: "visible", timeout: 30000 });
    await formSelect.selectOption({ label: "241 - TALON PRESENTACION" });
    await consulta.locator('input[name="periodoDesde"]').fill(displayPeriod(period));
    await consulta.locator('input[name="periodoHasta"]').fill(displayPeriod(period));
    await consulta.getByText("Búsqueda", { exact: true }).click();
    const row = consulta.locator("table tbody tr")
      .filter({ hasText: periodStateKey(period).replace("-", "") })
      .first();
    await row.waitFor({ state: "visible", timeout: 30000 });
    const [detail] = await Promise.all([
      context.waitForEvent("page", { timeout: 20000 }),
      row.getByText("Consultar", { exact: true }).click()
    ]);
    try {
      await detail.waitForLoadState("domcontentloaded");
      await waitForMarangatu(detail);
      return await saveJustificante(detail, period, "F241-talon");
    } finally {
      await detail.close().catch(() => {});
    }
  } finally {
    await consulta.close().catch(() => {});
  }
}

async function selectFormulario241Period(page, period) {
  await page.locator('select[name="anho"]').waitFor({ state: "visible", timeout: 20000 });
  await page.locator('select[name="anho"]').selectOption(String(period.year));
  await page.locator('select[name="mes"]').waitFor({ state: "visible", timeout: 20000 });
  await page.locator('select[name="mes"]').selectOption(String(period.month));
  await waitForMarangatu(page);
}

async function openFormulario241Gestion(page) {
  await openFormulario241Menu(page);

  // Rutas de sesión candidatas, de la más directa a la más frágil. Cada intento
  // fallido navega fuera del menú, así que se reabre antes del siguiente.
  const candidates = [
    async () => findMarangatuUrlInHtml(await page.content(), f241GestionPath),
    async () => env("MARANGATU_F241_GESTION_URL", ""),
    async () => {
      const url = await f241GestionMenuAction(page, "url").catch(error => {
        console.log(`Could not read F241 Gestion URL from Angular menu: ${error.message}`);
        return "";
      });
      if (url) console.log("Found F241 Gestion URL in Angular menu (redacted).");
      return url;
    }
  ];
  for (const candidate of candidates) {
    const url = await candidate();
    if (!url) continue;
    if (await tryOpenFormulario241GestionUrl(page, url)) return page;
    await openFormulario241Menu(page);
  }

  await clickF241GestionOption(page);
  await waitForMarangatu(page);
  await page.getByRole("heading", { name: f241GestionHeading })
    .waitFor({ state: "visible", timeout: 20000 });
  return page;
}

async function clickF241GestionOption(page) {
  const option = page.locator('[data-ng-click="vm.opcion(item.aplicacion)"]')
    .filter({ hasText: f241GestionOption })
    .first();

  await option.waitFor({ state: "visible", timeout: 10000 });
  await option.click();
  await page.waitForTimeout(1500);

  const opened = await page.getByRole("heading", { name: f241GestionHeading })
    .isVisible()
    .catch(() => false);
  if (opened) return;

  console.log("F241 Gestion menu click did not navigate; retrying through Angular controller.");
  await f241GestionMenuAction(page, "open");
}

// Busca la opción de Gestión de Comprobantes en el modelo Angular del menú.
// action "url" devuelve su URL absoluta (o ""); action "open" la abre.
async function f241GestionMenuAction(page, action) {
  return page.evaluate(({ text, action }) => {
    const menuRoot = document.querySelector('[data-ng-controller="MenuController as vm"]');
    const scope = window.angular && menuRoot ? window.angular.element(menuRoot).scope() : undefined;
    const vm = scope?.vm;
    const items = Array.isArray(vm?.datos?.menu) ? vm.datos.menu : [];
    const fields = ["descripcion", "nombre", "titulo", "texto"];
    const item = items.find(entry => [
      ...fields.map(field => entry?.[field]),
      ...fields.map(field => entry?.aplicacion?.[field])
    ].some(value => value && String(value).includes(text)));

    if (action === "url") {
      const rawUrl = item?.url || item?.aplicacion?.url || "";
      return rawUrl ? new URL(rawUrl, window.location.href).href : "";
    }
    if (!scope) throw new Error("Angular MenuController is not available.");
    if (!item) throw new Error(`Could not find menu option: ${text}`);
    scope.$apply(() => vm.opcion(item.aplicacion));
    return "";
  }, { text: f241GestionOption, action });
}

async function openFormulario241Menu(page) {
  await openHome(page);

  const category = page.getByText("Declaraciones Informativas", { exact: true }).first();
  await category.waitFor({ state: "visible", timeout: 10000 });
  await category.click();
  await page.waitForTimeout(1500);
  await checkpoint(page, "06-f241-category-open");
}

async function tryOpenFormulario241GestionUrl(page, gestionUrl) {
  console.log("Opening F241 Gestion URL (redacted).");
  // Una URL inválida o caducada no debe cortar los siguientes intentos.
  const navigated = await page.goto(gestionUrl, { waitUntil: "domcontentloaded" }).then(() => true, error => {
    console.log(`F241 Gestion URL failed to load: ${error.message.split("\n")[0]}`);
    return false;
  });
  if (!navigated) return false;
  await waitForMarangatu(page);

  const opened = await page.getByRole("heading", { name: f241GestionHeading })
    .isVisible()
    .catch(() => false);
  if (!opened) {
    console.log("F241 Gestion URL did not open in this session; falling back to menu click.");
    await checkpoint(page, "06-f241-gestion-url-failed");
  }
  return opened;
}

async function openFormulario241Talon(gestionPage) {
  const popupPromise = gestionPage.waitForEvent("popup", { timeout: 10000 }).catch(() => undefined);
  const confirmCard = gestionPage
    .getByText("Confirmar Presentación", { exact: true })
    .first()
    .locator("xpath=../..");
  await confirmCard.waitFor({ state: "visible", timeout: 20000 });
  await confirmCard.click();
  const popup = await popupPromise;
  const talonPage = popup || gestionPage;
  await talonPage.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => {});
  await waitForMarangatu(talonPage);

  if (!new URL(talonPage.url()).pathname.endsWith(f241TalonPath)) {
    const dynamicTalonUrl = findMarangatuUrlInHtml(await gestionPage.content(), f241TalonPath);
    if (!dynamicTalonUrl) {
      throw new Error("Could not open F241 talon presentation page.");
    }
    await talonPage.goto(dynamicTalonUrl, { waitUntil: "domcontentloaded" });
    await waitForMarangatu(talonPage);
  }

  await talonPage.getByRole("heading", { name: /Presentación de Talón|Presentacion de Talon/ })
    .waitFor({ state: "visible", timeout: 20000 });
  return talonPage;
}

async function runForm(page, formName, period, submit, args) {
  if (formName === "F120" ? args.skipF120 : args.skipF241) {
    return { form: formName, status: "saltado por flag", skipped: true, skippedReason: "skip flag" };
  }
  const outcome = await runFormWithStateTracking({
    formName,
    period,
    submit,
    retryError: args.retryError === formName,
    fn: () => formName === "F120"
      ? prepareFormulario120(page, period, submit, args.force)
      : prepareFormulario241(page, period, submit)
  });
  if (outcome.skipped) {
    return { form: formName, status: "ya presentado", skipped: true, skippedReason: outcome.reason };
  }
  return {
    form: formName,
    status: outcome.status,
    // Ruta relativa: el aviso no debe exponer la estructura local de carpetas.
    justificante: outcome.justificante && path.relative(rootDir, outcome.justificante)
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const period = targetPeriod(args);
  const mode = resolveRunMode(args, period);
  const submit = mode === "submit";

  console.log(`Target period: ${displayPeriod(period)}`);
  console.log(`Real submission enabled: ${submit ? "yes" : "no"}`);

  const browser = await chromium.launch({
    headless: booleanValue(process.env.MARANGATU_HEADLESS, false),
    slowMo: Number.parseInt(env("MARANGATU_SLOWMO_MS", "120"), 10) || 0
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  const results = [];
  let runError;
  try {
    await login(page);
    for (const formName of forms) {
      try {
        results.push(await runForm(page, formName, period, submit, args));
      } catch (error) {
        results.push({ form: formName, status: "error", error: error.message });
        runError = error;
        break;
      }
    }
    if (submit && !runError && !args.skipF120) {
      const verified = await consultFormulario120Presented(page, period, "98-f120-consult-final");
      if (!verified) {
        await setFormStatus(period, "F120", "error", {
          error: "No aparece en Consultar Declaraciones durante la verificación final."
        }).catch(() => {});
        throw new Error(`F120: la verificación final en Consultar Declaraciones no confirmó ${displayPeriod(period)}.`);
      }
      console.log(`F120 verified in Consultar Declaraciones for ${displayPeriod(period)}.`);
    }
  } catch (error) {
    if (!runError) {
      runError = error;
      results.push({ form: "GENERAL", status: "error", error: error.message });
    }
  } finally {
    if (runError) await checkpointOpenPages(context, "97-error");
    else await checkpoint(page, "99-final-state");
    await context.close().catch(error => {
      console.log(`No se pudo cerrar el contexto del navegador: ${error.message}`);
    });
    await browser.close().catch(error => {
      console.log(`No se pudo cerrar el navegador: ${error.message}`);
    });
  }

  const hasNewPresentation = results.some(result => result.status === "presentado");
  let notifications = notificationPolicy({ submit, runError, hasNewPresentation });

  if (notifications.sendEmail) {
    try {
      const emailResult = await sendPresentationConfirmation({
        period,
        results,
        stateFile: emailStateFile
      });
      console.log(emailResult.skipped
        ? "Email de confirmación ya enviado para este período; no se duplica."
        : "Email de confirmación enviado correctamente.");
    } catch (error) {
      const emailError = `La presentación fiscal terminó, pero falló el email de confirmación: ${error.message}`;
      results.push({ form: "EMAIL", status: "error", error: emailError });
      runError = new Error(emailError);
    }
  } else if (!notifications.emailEnabled) {
    console.log("Email skipped (MARANGATU_EMAIL_ENABLED=false).");
  } else {
    console.log("Email skipped (no hay una presentación nueva verificada).");
  }

  // Se recalcula porque un fallo del email convierte la ejecución en error.
  notifications = notificationPolicy({ submit, runError, hasNewPresentation });
  if (notifications.sendTelegram) {
    const summary = buildResultSummary({ period, mode, results });
    console.log(`Resumen Telegram:\n${summary}`);
    await sendTelegramMessage(summary, { referencia: `marangatu-${periodStateKey(period)}` });
  } else if (!notifications.telegramEnabled) {
    console.log("Telegram skipped (MARANGATU_TELEGRAM_ENABLED=false).");
  } else {
    console.log("Telegram skipped (dry-run sin errores).");
  }

  if (runError) throw runError;
}

const isCliRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isCliRun) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
