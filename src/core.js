// Lógica pura compartida por el CLI, el lanzador supervisado y los
// notificadores. Sin efectos secundarios al importar: no lee .env ni carga
// Playwright, para que los tests y el lanzador puedan usarla directamente.

const defaultTimeZone = "Europe/Madrid";
const forms = ["F120", "F241"];

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

function booleanValue(value, fallback = false) {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "si"].includes(String(value).toLowerCase());
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function redactSessionUrls(text) {
  return String(text).replace(/_cyp=[^"'&\s<>]+/g, "_cyp=REDACTED");
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

// Formato del portal: MM/YYYY.
function displayPeriod(period) {
  return `${String(period.month).padStart(2, "0")}/${period.year}`;
}

// Clave de estado, carpetas y --confirm-period: YYYY-MM.
function periodStateKey(period) {
  return `${period.year}-${String(period.month).padStart(2, "0")}`;
}

function validatePeriod(period) {
  if (!Number.isInteger(period.year) || period.year < 2020) {
    throw new Error(`Invalid year: ${period.year}`);
  }
  if (!Number.isInteger(period.month) || period.month < 1 || period.month > 12) {
    throw new Error(`Invalid month: ${period.month}`);
  }
}

function targetPeriod(args, now = new Date()) {
  const hasYear = args.year !== undefined;
  const hasMonth = args.month !== undefined;
  if (hasYear !== hasMonth) {
    throw new Error("--year y --month deben pasarse juntos. Sin ambos, se usa el mes anterior por defecto.");
  }
  const period = hasYear
    ? { year: args.year, month: args.month }
    : previousMonthPeriod(now);
  validatePeriod(period);
  return period;
}

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

  const valueOf = (index, name) => {
    if (argv[index + 1] === undefined) throw new Error(`Falta el valor de ${name}.`);
    return argv[index + 1];
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--submit") args.submit = true;
    else if (arg === "--skip-f120") args.skipF120 = true;
    else if (arg === "--skip-f241") args.skipF241 = true;
    else if (arg === "--force") args.force = true;
    else if (arg === "--year") args.year = Number(valueOf(i++, arg));
    else if (arg === "--month") args.month = Number(valueOf(i++, arg));
    else if (arg === "--confirm-period") args.confirmPeriod = valueOf(i++, arg);
    else if (arg === "--retry-error") {
      args.retryError = valueOf(i++, arg).toUpperCase();
      if (!forms.includes(args.retryError)) {
        throw new Error("--retry-error solo acepta F120 o F241.");
      }
    } else {
      throw new Error(`Argumento no reconocido: ${arg}`);
    }
  }

  return args;
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

  if (args.force) {
    throw new Error("--force solo puede usarse en dry-run.");
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
  return normalizePortalText(row.periodo) === displayPeriod(period) &&
    normalizePortalText(row.formulario).startsWith(`${formCode}-`) &&
    acceptedDeclarationStates.has(normalizePortalText(row.estado)) &&
    normalizePortalText(row.activa) === "S";
}

export {
  defaultTimeZone,
  forms,
  monthLabels,
  booleanValue,
  escapeHtml,
  redactSessionUrls,
  datePartsInTimeZone,
  previousMonthPeriod,
  displayPeriod,
  periodStateKey,
  validatePeriod,
  targetPeriod,
  parseArgs,
  resolveRunMode,
  notificationPolicy,
  matchesPresentedDeclaration
};
