import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import { chromium } from "playwright";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const artifactsDir = path.resolve(rootDir, process.env.MARANGATU_ARTIFACTS_DIR || "artifacts");

const baseUrl = "https://marangatu.set.gov.py/eset/";
const loginUrl = `${baseUrl}login`;

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
    year: undefined,
    month: undefined
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--submit") args.submit = true;
    else if (arg === "--skip-f120") args.skipF120 = true;
    else if (arg === "--skip-f241") args.skipF241 = true;
    else if (arg === "--year") args.year = Number(argv[++i]);
    else if (arg === "--month") args.month = Number(argv[++i]);
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

function validatePeriod(period) {
  if (!Number.isInteger(period.year) || period.year < 2020) {
    throw new Error(`Invalid year: ${period.year}`);
  }
  if (!Number.isInteger(period.month) || period.month < 1 || period.month > 12) {
    throw new Error(`Invalid month: ${period.month}`);
  }
}

function targetPeriod(args) {
  if ((args.year && !args.month) || (!args.year && args.month)) {
    throw new Error("--year y --month deben pasarse juntos. Sin ambos, se usa el mes anterior por defecto.");
  }
  const period = args.year && args.month
    ? { year: args.year, month: args.month }
    : previousMonthPeriod();
  validatePeriod(period);
  return period;
}

function previousMonthPeriod(now = new Date()) {
  // Hora local (la maquina Windows corre en TZ Madrid). Usar UTC mete bugs
  // el dia 1 de madrugada cuando UTC todavia esta en el mes anterior.
  const year = now.getFullYear();
  const monthIndex = now.getMonth(); // 0=Ene
  if (monthIndex === 0) {
    return { year: year - 1, month: 12 };
  }
  return { year, month: monthIndex };
}

function periodKey(period) {
  return `${String(period.month).padStart(2, "0")}/${period.year}`;
}

async function ensureArtifactsDir() {
  await fs.mkdir(artifactsDir, { recursive: true });
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

  await page.locator('input[placeholder="Usuario"]').fill(env("MARANGATU_USER"));
  await page.locator('input[type="password"]').fill(env("MARANGATU_PASSWORD"));
  await checkpoint(page, "01-login-filled");

  await page.getByRole("button", { name: "Acceder", exact: true }).click();
  await waitForMarangatu(page);

  const userName = env("MARANGATU_EXPECTED_NAME", "");
  if (userName) {
    await page.getByText(userName, { exact: false }).waitFor({ state: "visible", timeout: 20000 });
  } else {
    await page.getByPlaceholder("Busqueda opcion de menu", { exact: false }).waitFor({ state: "visible", timeout: 20000 }).catch(() => {});
  }

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

async function openPresentDeclaration(page) {
  const href = await findCommonOptionHref(page, "Presentar Declaracion")
    .catch(() => findCommonOptionHref(page, "Presentar Declaración"));
  console.log(`Opening Presentar Declaracion via href: ${href}`);
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

async function maybeAlreadyPresented(page, period) {
  await openHome(page);
  const latestDeclarations = page.getByText(periodKey(period), { exact: true });
  return (await latestDeclarations.count()) > 0;
}

async function prepareFormulario120(page, period, submit) {
  if (await maybeAlreadyPresented(page, period)) {
    console.log(`F120 appears in Ultimas Declaraciones for ${periodKey(period)}. Skipping duplicate preparation.`);
    await checkpoint(page, "03-f120-already-presented");
    return;
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
    console.log("F120 stopped before final submission because submit mode is off.");
    return;
  }

  await safeClick(page, page.getByRole("button", { name: /Presentar Declaraci.n/ }), "Presentar Declaracion");
  const confirm = page.getByRole("button", { name: /Confirmar|Aceptar|Presentar/ }).first();
  if (await confirm.isVisible().catch(() => false)) {
    await safeClick(page, confirm, "Confirmar F120");
  }
  await checkpoint(page, "05-f120-submitted");
}

async function prepareFormulario241(page, period, submit) {
  console.log(`Opening F241 menu candidate for ${periodKey(period)}.`);
  await openHome(page);

  const category = page.getByText("Declaraciones Informativas", { exact: false });
  const categoryCount = await category.count();
  if (categoryCount < 2) {
    throw new Error(`Expected two Declaraciones Informativas menu entries; found ${categoryCount}.`);
  }

  await category.nth(1).click();
  await page.waitForTimeout(1500);
  await checkpoint(page, "06-f241-category-open");

  const option = page.getByText("Gestion De Comprobantes Informativos", { exact: true });
  await option.waitFor({ state: "visible", timeout: 10000 });

  if (!submit) {
    console.log("F241 menu option is visible. Dry-run stops here because the portal did not expose a stable direct href during exploration.");
    return;
  }

  await option.click();
  await waitForMarangatu(page);
  await checkpoint(page, "07-f241-after-menu-click");

  const yearSelect = page.locator("select").filter({ has: page.locator("option", { hasText: String(period.year) }) }).first();
  if (await yearSelect.isVisible().catch(() => false)) await yearSelect.selectOption({ label: String(period.year) });

  const monthSelect = page.locator("select").filter({ has: page.locator("option", { hasText: monthLabels[period.month - 1] }) }).first();
  if (await monthSelect.isVisible().catch(() => false)) await monthSelect.selectOption({ label: monthLabels[period.month - 1] });

  await checkpoint(page, "08-f241-period-selected");
  await safeClick(page, page.getByRole("button", { name: /Confirmar Presentaci|Confirmar|Presentar/ }).first(), "Confirmar F241");
  await checkpoint(page, "09-f241-submitted");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const period = targetPeriod(args);
  const submit = !args.dryRun && (args.submit || boolEnv("MARANGATU_SUBMIT"));

  console.log(`Target period: ${periodKey(period)}`);
  console.log(`Real submission enabled: ${submit ? "yes" : "no"}`);

  const browser = await chromium.launch({
    headless: boolEnv("MARANGATU_HEADLESS", false),
    slowMo: Number(env("MARANGATU_SLOWMO_MS", "120"))
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  try {
    await login(page);
    if (!args.skipF120) await prepareFormulario120(page, period, submit);
    if (!args.skipF241) await prepareFormulario241(page, period, submit);
    await checkpoint(page, "99-final-state");
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
