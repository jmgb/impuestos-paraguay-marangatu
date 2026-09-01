import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import dotenv from "dotenv";
import { chromium } from "playwright";

import { sendPresentationConfirmation } from "./email-notifier.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const artifactsDir = path.resolve(rootDir, process.env.MARANGATU_ARTIFACTS_DIR || "artifacts");
const presentacionesDir = path.resolve(rootDir, process.env.MARANGATU_PRESENTACIONES_DIR || "presentaciones");

const baseUrl = "https://marangatu.set.gov.py/eset/";
const loginUrl = `${baseUrl}login`;
const defaultTimeZone = "Europe/Madrid";
const f241GestionPath = "gestionComprobantesVirtuales.do";
const f241TalonPath = "gdi/presentacionTalonResumen.do";
const stateDir = path.resolve(rootDir, ".state");
const formStateFile = path.join(stateDir, "forms.json");
const emailStateFile = path.join(stateDir, "email-notifications.json");

const monthLabels = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Setiembre",
  "Octubre",
  "Noviembre",
  "Diciembre"
];

function parseArgs(argv) {
  const args = {
    dryRun: false,
    submit: false,
    skipF120: false,
    skipF241: false,
    force: false,
    year: undefined,
    month: undefined,
    confirmPeriod: undefined,
    retryError: undefined
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--submit") args.submit = true;
    else if (arg === "--skip-f120") args.skipF120 = true;
    else if (arg === "--skip-f241") args.skipF241 = true;
    else if (arg === "--force") args.force = true;
    else if (arg === "--year") {
      if (argv[i + 1] === undefined) throw new Error("Falta el valor de --year.");
      args.year = Number(argv[++i]);
    } else if (arg === "--month") {
      if (argv[i + 1] === undefined) throw new Error("Falta el valor de --month.");
      args.month = Number(argv[++i]);
    } else if (arg === "--confirm-period") {
      if (argv[i + 1] === undefined) throw new Error("Falta el valor de --confirm-period.");
      args.confirmPeriod = argv[++i];
    } else if (arg === "--retry-error") {
      if (argv[i + 1] === undefined) throw new Error("Falta el valor de --retry-error.");
      args.retryError = argv[++i].toUpperCase();
      if (!["F120", "F241"].includes(args.retryError)) {
        throw new Error("--retry-error solo acepta F120 o F241.");
      }
    } else {
      throw new Error(`Argumento no reconocido: ${arg}`);
    }
  }

  return args;
}

function env(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === "") {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function boolEnv(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "si"].includes(value.toLowerCase());
}

function booleanValue(value, fallback = false) {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "si"].includes(String(value).toLowerCase());
}

function notificationPolicy({ submit, runError, hasNewPresentation, environment = process.env }) {
  const emailEnabled = booleanValue(environment.MARANGATU_EMAIL_ENABLED, false);
  const telegramEnabled = booleanValue(environment.MARANGATU_TELEGRAM_ENABLED, false);
  const notifyDryRun = booleanValue(environment.MARANGATU_TELEGRAM_NOTIFY_DRY_RUN, false);
  return {
    emailEnabled,
    telegramEnabled,
    sendEmail: emailEnabled && submit && !runError && hasNewPresentation,
    sendTelegram: telegramEnabled && (submit || Boolean(runError) || notifyDryRun)
  };
}

function validatePeriod(period) {
  if (!Number.isInteger(period.year) || period.year < 2020) {
    throw new Error(`Invalid year: ${period.year}`);
  }
  if (!Number.isInteger(period.month) || period.month < 1 || period.month > 12) {
    throw new Error(`Invalid month: ${period.month}`);
  }
}

function targetPeriod(args) {
  const hasYear = args.year !== undefined;
  const hasMonth = args.month !== undefined;
  if (hasYear !== hasMonth) {
    throw new Error("--year y --month deben pasarse juntos. Sin ambos, se usa el mes anterior por defecto.");
  }
  const period = hasYear
    ? { year: args.year, month: args.month }
    : previousMonthPeriod();
  validatePeriod(period);
  return period;
}

function datePartsInTimeZone(now, timeZone = defaultTimeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric"
  }).formatToParts(now);

  const value = type => Number(parts.find(part => part.type === type)?.value);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day")
  };
}

function previousMonthPeriod(now = new Date(), timeZone = defaultTimeZone) {
  const { year, month } = datePartsInTimeZone(now, timeZone);
  if (month === 1) {
    return { year: year - 1, month: 12 };
  }
  return { year, month: month - 1 };
}

function periodKey(period) {
  return `${String(period.month).padStart(2, "0")}/${period.year}`;
}

function periodStateKey(period) {
  return `${period.year}-${String(period.month).padStart(2, "0")}`;
}

function resolveRunMode(args, period, environment = process.env) {
  if (args.dryRun && args.submit) {
    throw new Error("--dry-run y --submit son modos excluyentes.");
  }

  if (!args.submit) {
    if (args.confirmPeriod) {
      throw new Error("--confirm-period solo puede usarse junto con --submit.");
    }
    if (args.retryError) {
      throw new Error("--retry-error solo puede usarse junto con --submit.");
    }
    return "dry-run";
  }

  if (!booleanValue(environment.MARANGATU_SUBMIT, false)) {
    throw new Error("El modo real requiere MARANGATU_SUBMIT=true además de --submit.");
  }

  const expectedPeriod = periodStateKey(period);
  if (args.confirmPeriod !== expectedPeriod) {
    throw new Error(`El modo real requiere --confirm-period ${expectedPeriod}.`);
  }
  return "submit";
}

async function loadFormState(filePath = formStateFile) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

async function saveFormState(state, filePath = formStateFile) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(state, null, 2), "utf8");
}

async function getFormStatus(period, form, filePath = formStateFile) {
  const state = await loadFormState(filePath);
  const entry = state[periodStateKey(period)];
  return entry && entry[form] ? entry[form] : null;
}

async function setFormStatus(period, form, status, extra = {}, filePath = formStateFile) {
  const state = await loadFormState(filePath);
  const key = periodStateKey(period);
  state[key] = state[key] || {};
  state[key][form] = {
    status,
    updated_at: new Date().toISOString(),
    ...extra
  };
  await saveFormState(state, filePath);
}

async function runFormWithStateTracking({ formName, period, submit, force, retryError = false, fn, stateFilePath = formStateFile }) {
  if (submit) {
    const previous = await getFormStatus(period, formName, stateFilePath);
    if (previous && ["presentado", "sin-pendientes"].includes(previous.status)) {
      console.log(`${formName}: ya tiene estado terminal '${previous.status}' para ${periodKey(period)}. Saltando para evitar duplicados.`);
      return { skipped: true, reason: previous.status };
    }
    if (previous && previous.status === "error" && !retryError) {
      throw new Error(`${formName}: estado 'error' previo para ${periodKey(period)}. Revise artifacts/ y autorice --retry-error ${formName} para reintentar.`);
    }
  }

  if (submit) {
    await setFormStatus(period, formName, "iniciado", {}, stateFilePath).catch(error => {
      console.log(`No se pudo persistir estado 'iniciado' de ${formName}: ${error.message}`);
    });
  }

  try {
    const result = await fn();
    if (submit) {
      const finalStatus = result && result.stateStatus ? result.stateStatus : "presentado";
      await setFormStatus(period, formName, finalStatus, {}, stateFilePath).catch(error => {
        console.log(`No se pudo persistir estado '${finalStatus}' de ${formName}: ${error.message}`);
      });
    }
    return result;
  } catch (error) {
    if (submit) {
      await setFormStatus(period, formName, "error", { error: error.message }, stateFilePath).catch(() => {});
    }
    throw error;
  }
}

async function ensureArtifactsDir() {
  await fs.mkdir(artifactsDir, { recursive: true });
}

function escapeTelegramHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function sendTelegramMessage(text, { token, chatId, referencia = "" } = {}) {
  const finalToken = token || process.env.MARANGATU_TELEGRAM_TOKEN;
  const finalChatId = chatId || process.env.MARANGATU_TELEGRAM_CHAT_ID;

  if (!finalToken || !finalChatId) {
    console.log(`Telegram skipped (token/chat_id no configurados)${referencia ? ` ref=${referencia}` : ""}.`);
    return false;
  }

  const url = `https://api.telegram.org/bot${finalToken}/sendMessage`;
  const body = JSON.stringify({
    chat_id: finalChatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true
  });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(10000)
      });

      if (response.ok) {
        console.log(`Telegram enviado correctamente${referencia ? ` ref=${referencia}` : ""}.`);
        return true;
      }

      const detail = await response.text().catch(() => "");
      if (response.status === 429 && attempt < 2) {
        console.log(`Telegram 429, esperando 10s antes de reintentar (intento ${attempt + 1}/3).`);
        await new Promise(resolve => setTimeout(resolve, 10000));
        continue;
      }
      console.log(`Telegram fallo HTTP ${response.status}: ${detail.slice(0, 200)}`);
      return false;
    } catch (error) {
      console.log(`Telegram error de red (intento ${attempt + 1}/3): ${error.message}`);
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
  return false;
}

function buildResultSummary({ period, mode, results }) {
  const statusIcon = result => {
    if (result.skipped) return "⏭️";
    if (result.error) return "❌";
    return "✅";
  };

  const hasError = results.some(result => result.error || result.status === "error");
  const headline = hasError
    ? `Ejecución con errores para ${periodKey(period)}.`
    : mode === "submit"
      ? `Presentación completada correctamente para ${periodKey(period)}.`
      : `Dry run completado correctamente para ${periodKey(period)}. No se presentó ningún formulario.`;
  const lines = [`<b>[PARAGUAY IMPUESTOS]</b> ${escapeTelegramHtml(headline)}`];
  for (const result of results) {
    const detail = result.error
      ? ` — ${escapeTelegramHtml(result.error)}`
      : result.skippedReason
        ? ` (${escapeTelegramHtml(result.skippedReason)})`
        : "";
    lines.push(`${statusIcon(result)} <b>${escapeTelegramHtml(result.form)}</b>: ${escapeTelegramHtml(result.status)}${detail}`);
    if (result.justificante) {
      lines.push(`   Justificante: ${escapeTelegramHtml(result.justificante)}`);
    }
  }
  lines.push("", mode === "dry-run" ? "Modo: simulación segura" : "Modo: presentación real");
  return lines.join("\n");
}

async function saveScreenshot(page, name) {
  await ensureArtifactsDir();
  const filePath = path.join(artifactsDir, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

async function saveHtml(page, name) {
  await ensureArtifactsDir();
  const filePath = path.join(artifactsDir, `${name}.html`);
  await fs.writeFile(filePath, await page.content(), "utf8");
  return filePath;
}

async function checkpoint(page, name) {
  const png = await saveScreenshot(page, name).catch(() => undefined);
  const html = await saveHtml(page, name).catch(() => undefined);
  if (png) console.log(`Screenshot: ${png}`);
  if (html) console.log(`HTML: ${html}`);
}

async function saveJustificante(page, period, formName) {
  const periodDir = path.join(presentacionesDir, periodStateKey(period));
  await fs.mkdir(periodDir, { recursive: true });
  const filePath = path.join(periodDir, `${formName}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  console.log(`Justificante guardado: ${filePath}`);
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

  const userName = env("MARANGATU_EXPECTED_NAME", "");
  if (userName) {
    await page.getByRole("link", { name: userName, exact: true }).waitFor({ state: "visible", timeout: 20000 });
  }
  await page.locator('input[name="busqueda"], input[placeholder*="men"]').waitFor({ state: "visible", timeout: 20000 });

  await checkpoint(page, "02-home-after-login");
  console.log("Login completed.");
}

async function findCommonOptionHref(page, optionName) {
  await openHome(page);
  const link = page.getByRole("link", { name: optionName, exact: true });
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
  const href = await findCommonOptionHref(page, "Presentar Declaracion")
    .catch(() => findCommonOptionHref(page, "Presentar Declaración"));
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

const acceptedDeclarationStates = new Set([
  "ACEPTADO",
  "APROBADO",
  "CUMPLIDO",
  "PROCESADO CC",
  "PROCESADO CCERA",
  "VERIFICADO"
]);

function normalizePortalText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toUpperCase();
}

function matchesPresentedDeclaration(row, period, formCode) {
  return normalizePortalText(row.periodo) === normalizePortalText(periodKey(period)) &&
    normalizePortalText(row.formulario).startsWith(`${formCode}-`) &&
    acceptedDeclarationStates.has(normalizePortalText(row.estado)) &&
    normalizePortalText(row.activa) === "S";
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
        if (Array.isArray(child)) {
          for (const item of child) {
            const found = find(item);
            if (found) return found;
          }
        } else if (child && typeof child === "object") {
          const found = find(child);
          if (found) return found;
        }
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
  await page.locator('input[name="periodo"]').fill(periodKey(period));
  await page.locator('input[name="periodoHasta"]').fill(periodKey(period));
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
  if (alreadyPresented && !(force && !submit)) {
    console.log(`F120 appears in Ultimas Declaraciones for ${periodKey(period)}. Skipping duplicate preparation.`);
    await checkpoint(page, "03-f120-already-presented");
    return { status: "ya presentado en portal", stateStatus: "presentado" };
  }

  if (alreadyPresented) {
    console.log(`F120 ${periodKey(period)} is already presented; forcing dry-run UI verification without submission.`);
  }

  console.log(`Preparing F120 for ${periodKey(period)}.`);
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
  if (!await verifyFormulario120Presented(page, period, "05-f120-consult-after-submit")) {
    throw new Error(`F120: no aparece como declaración presentada y activa en Consultar Declaraciones para ${periodKey(period)}.`);
  }
  await checkpoint(page, "05-f120-submitted-verified");
  const justificante = await saveJustificante(page, period, "F120").catch(error => {
    console.log(`No se pudo guardar justificante F120: ${error.message}`);
    return undefined;
  });
  return { status: "presentado", justificante };
}

async function prepareFormulario241(page, period, submit) {
  console.log(`Preparing F241 talon presentation for ${periodKey(period)}.`);
  const gestionPage = await openFormulario241Gestion(page);
  await checkpoint(gestionPage, "06-f241-gestion");

  const talonPage = await openFormulario241Talon(gestionPage);
  await checkpoint(talonPage, "07-f241-talon-opened");

  await selectFormulario241Period(talonPage, period);
  await checkpoint(talonPage, "08-f241-period-selected");

  if (await talonPage.getByText("No existen talones pendientes de presentación", { exact: false }).isVisible().catch(() => false)) {
    console.log(`F241 has no pending talons for ${periodKey(period)}.`);
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

  const verificationGestionPage = await openFormulario241Gestion(gestionPage);
  const verificationPage = await openFormulario241Talon(verificationGestionPage);
  await selectFormulario241Period(verificationPage, period);
  const noPending = await verificationPage
    .getByText("No existen talones pendientes de presentación", { exact: false })
    .isVisible()
    .catch(() => false);
  await checkpoint(verificationPage, "12-f241-submitted-verified");
  if (!noPending) {
    throw new Error(`F241: el portal aún muestra talones pendientes para ${periodKey(period)} tras confirmar.`);
  }

  const justificante = await saveJustificante(verificationPage, period, "F241").catch(error => {
    console.log(`No se pudo guardar justificante F241: ${error.message}`);
    return undefined;
  });
  return { status: "presentado", justificante };
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

  const dynamicUrl = findMarangatuUrlInHtml(await page.content(), f241GestionPath);
  const fallbackUrl = env("MARANGATU_F241_GESTION_URL", "");
  const gestionUrl = dynamicUrl || fallbackUrl;
  if (gestionUrl && await tryOpenFormulario241GestionUrl(page, gestionUrl)) {
    return page;
  }

  await openFormulario241Menu(page);
  const angularGestionUrl = await findF241GestionUrlFromAngularMenu(page);
  if (angularGestionUrl && await tryOpenFormulario241GestionUrl(page, angularGestionUrl)) {
    return page;
  }

  await clickF241GestionOption(page);
  await waitForMarangatu(page);
  await page.getByRole("heading", { name: /Gestión de Comprobantes|Gestion de Comprobantes/ })
    .waitFor({ state: "visible", timeout: 20000 });
  return page;
}

async function clickF241GestionOption(page) {
  const optionText = "Gestion De Comprobantes Informativos";
  const option = page.locator('[data-ng-click="vm.opcion(item.aplicacion)"]')
    .filter({ hasText: optionText })
    .first();

  await option.waitFor({ state: "visible", timeout: 10000 });
  await option.click();
  await page.waitForTimeout(1500);

  const opened = await page.getByRole("heading", { name: /Gestión de Comprobantes|Gestion de Comprobantes/ })
    .isVisible()
    .catch(() => false);
  if (opened) return;

  console.log("F241 Gestion menu click did not navigate; retrying through Angular controller.");
  await page.evaluate(text => {
    const angularRef = window.angular;
    const menuRoot = document.querySelector('[data-ng-controller="MenuController as vm"]');
    if (!angularRef || !menuRoot) throw new Error("Angular MenuController is not available.");

    const scope = angularRef.element(menuRoot).scope();
    const vm = scope && scope.vm;
    const item = findAngularMenuItem(vm && vm.datos && vm.datos.menu, text);
    if (!item) throw new Error(`Could not find menu option: ${text}`);

    scope.$apply(() => vm.opcion(item.aplicacion));

    function findAngularMenuItem(items, expectedText) {
      if (!Array.isArray(items)) return undefined;
      return items.find(item => {
        const values = [
          item && item.descripcion,
          item && item.nombre,
          item && item.titulo,
          item && item.texto,
          item && item.aplicacion && item.aplicacion.descripcion,
          item && item.aplicacion && item.aplicacion.nombre,
          item && item.aplicacion && item.aplicacion.titulo,
          item && item.aplicacion && item.aplicacion.texto
        ];
        return values.filter(Boolean).some(value => String(value).includes(expectedText));
      });
    }
  }, optionText);
}

async function findF241GestionUrlFromAngularMenu(page) {
  const optionText = "Gestion De Comprobantes Informativos";
  const url = await page.evaluate(text => {
    const angularRef = window.angular;
    const menuRoot = document.querySelector('[data-ng-controller="MenuController as vm"]');
    if (!angularRef || !menuRoot) return "";

    const scope = angularRef.element(menuRoot).scope();
    const vm = scope && scope.vm;
    const item = findAngularMenuItem(vm && vm.datos && vm.datos.menu, text);
    if (!item) return "";

    const rawUrl = item.url || (item.aplicacion && item.aplicacion.url) || "";
    return rawUrl ? new URL(rawUrl, window.location.href).href : "";

    function findAngularMenuItem(items, expectedText) {
      if (!Array.isArray(items)) return undefined;
      return items.find(item => {
        const values = [
          item && item.descripcion,
          item && item.nombre,
          item && item.titulo,
          item && item.texto,
          item && item.aplicacion && item.aplicacion.descripcion,
          item && item.aplicacion && item.aplicacion.nombre,
          item && item.aplicacion && item.aplicacion.titulo,
          item && item.aplicacion && item.aplicacion.texto
        ];
        return values.filter(Boolean).some(value => String(value).includes(expectedText));
      });
    }
  }, optionText).catch(error => {
    console.log(`Could not read F241 Gestion URL from Angular menu: ${error.message}`);
    return "";
  });

  if (url) console.log("Found F241 Gestion URL in Angular menu (redacted).");
  return url;
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
  await page.goto(gestionUrl, { waitUntil: "domcontentloaded" });
  await waitForMarangatu(page);

  const opened = await page.getByRole("heading", { name: /Gestión de Comprobantes|Gestion de Comprobantes/ })
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const period = targetPeriod(args);
  const mode = resolveRunMode(args, period);
  const submit = mode === "submit";

  console.log(`Target period: ${periodKey(period)}`);
  console.log(`Real submission enabled: ${submit ? "yes" : "no"}`);

  const browser = await chromium.launch({
    headless: boolEnv("MARANGATU_HEADLESS", false),
    slowMo: Number(env("MARANGATU_SLOWMO_MS", "120"))
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  const results = [];
  let runError;
  try {
    await login(page);
    for (const formName of ["F120", "F241"]) {
      const skipFlag = formName === "F120" ? args.skipF120 : args.skipF241;
      if (skipFlag) {
        results.push({ form: formName, status: "saltado por flag", skipped: true, skippedReason: "skip flag" });
        continue;
      }
      try {
        const outcome = await runFormWithStateTracking({
          formName,
          period,
          submit,
          force: args.force,
          retryError: args.retryError === formName,
          fn: () => formName === "F120"
            ? prepareFormulario120(page, period, submit, args.force)
            : prepareFormulario241(page, period, submit)
        });
        if (outcome && outcome.skipped) {
          results.push({ form: formName, status: "ya presentado", skipped: true, skippedReason: outcome.reason || "estado previo" });
        } else {
          results.push({
            form: formName,
            status: outcome && outcome.status ? outcome.status : (submit ? "presentado" : "dry-run ok"),
            justificante: outcome && outcome.justificante
          });
        }
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
        throw new Error(`F120: la verificación final en Consultar Declaraciones no confirmó ${periodKey(period)}.`);
      }
      console.log(`F120 verified in Consultar Declaraciones for ${periodKey(period)}.`);
    }
    await checkpoint(page, "99-final-state");
  } catch (error) {
    if (!runError) {
      runError = error;
      results.push({ form: "GENERAL", status: "error", error: error.message });
    }
  } finally {
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

export {
  parseArgs,
  datePartsInTimeZone,
  previousMonthPeriod,
  targetPeriod,
  periodStateKey,
  resolveRunMode,
  notificationPolicy,
  matchesPresentedDeclaration,
  loadFormState,
  saveFormState,
  getFormStatus,
  setFormStatus,
  runFormWithStateTracking,
  escapeTelegramHtml,
  buildResultSummary,
  sendTelegramMessage
};
