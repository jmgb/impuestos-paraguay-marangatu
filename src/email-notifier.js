import fs from "node:fs/promises";
import path from "node:path";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function periodKey(period) {
  return `${period.year}-${String(period.month).padStart(2, "0")}`;
}

function displayPeriod(period) {
  return `${String(period.month).padStart(2, "0")}/${period.year}`;
}

function parseEnvText(text) {
  const values = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

async function resolveGmailConfig(env = process.env) {
  let credentials = {
    clientId: env.MARANGATU_GMAIL_CLIENT_ID,
    clientSecret: env.MARANGATU_GMAIL_CLIENT_SECRET,
    refreshToken: env.MARANGATU_GMAIL_REFRESH_TOKEN
  };

  const credentialsFile = env.MARANGATU_GMAIL_CREDENTIALS_ENV;
  if (credentialsFile) {
    const values = parseEnvText(await fs.readFile(credentialsFile, "utf8"));
    const refreshTokenKey = env.MARANGATU_GMAIL_REFRESH_TOKEN_ENV || "GOOGLE_REFRESH_TOKEN";
    credentials = {
      clientId: values.GOOGLE_CLIENT_ID,
      clientSecret: values.GOOGLE_CLIENT_SECRET,
      refreshToken: values[refreshTokenKey]
    };
  }

  const config = {
    ...credentials,
    from: env.MARANGATU_GMAIL_FROM,
    to: env.MARANGATU_GMAIL_TO
  };
  const missing = Object.entries(config)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length) {
    throw new Error(`Configuración Gmail incompleta: ${missing.join(", ")}`);
  }
  return config;
}

function buildPresentationEmail({ period, results }) {
  const subject = `[PARAGUAY IMPUESTOS] Presentación completada ${displayPeriod(period)}`;
  const rows = results
    .filter(result => ["F120", "F241"].includes(result.form))
    .map(result => `<li><strong>${escapeHtml(result.form)}</strong>: ${escapeHtml(result.status)}</li>`)
    .join("");
  const html = [
    "<p>La presentación de impuestos de Paraguay ha finalizado correctamente.</p>",
    `<p><strong>Período:</strong> ${escapeHtml(displayPeriod(period))}</p>`,
    `<ul>${rows}</ul>`,
    "<p>Los justificantes se han guardado localmente en el archivo de presentaciones.</p>",
    "<p>Mensaje automático de Paraguay Impuestos.</p>"
  ].join("");
  return { subject, html };
}

function retryableStatus(status) {
  return status === 429 || status >= 500;
}

async function requestWithRetry(url, options, {
  fetchImpl = fetch,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  attempts = 3
} = {}) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        ...options,
        signal: AbortSignal.timeout(15000)
      });
      if (response.ok) return response;
      const detail = await response.text().catch(() => "");
      const error = new Error(`Gmail API HTTP ${response.status}: ${detail.slice(0, 160)}`);
      error.status = response.status;
      if (!retryableStatus(response.status) || attempt === attempts - 1) throw error;
      lastError = error;
    } catch (error) {
      lastError = error;
      if (error.status && !retryableStatus(error.status)) throw error;
      if (attempt === attempts - 1) throw error;
    }
    await sleep(1000 * (2 ** attempt));
  }
  throw lastError;
}

async function getAccessToken(config, dependencies = {}) {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: config.refreshToken,
    grant_type: "refresh_token"
  });
  const response = await requestWithRetry(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  }, dependencies);
  const payload = await response.json();
  if (!payload.access_token) throw new Error("Google OAuth no devolvió access_token.");
  return payload.access_token;
}

function buildRawMessage({ from, to, subject, html, messageId }) {
  const encodedSubject = `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`;
  const lines = [
    `From: Paraguay Impuestos <${from}>`,
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    `Message-ID: <${messageId}>`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(html, "utf8").toString("base64")
  ];
  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
}

async function loadState(stateFile) {
  try {
    return JSON.parse(await fs.readFile(stateFile, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

async function saveState(stateFile, state) {
  await fs.mkdir(path.dirname(stateFile), { recursive: true });
  const temporary = `${stateFile}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await fs.rename(temporary, stateFile);
}

async function verifyGmailConnection({ env = process.env, ...dependencies } = {}) {
  const config = await resolveGmailConfig(env);
  const accessToken = await getAccessToken(config, dependencies);
  const response = await requestWithRetry(`${GMAIL_API}/profile`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  }, dependencies);
  const profile = await response.json();
  return { emailAddress: profile.emailAddress || config.from };
}

async function sendTestEmail({ env = process.env } = {}, dependencies = {}) {
  const config = await resolveGmailConfig(env);
  const accessToken = await getAccessToken(config, dependencies);
  const subject = "[PARAGUAY IMPUESTOS] Prueba de confirmación por email";
  const html = [
    "<p>Este es un correo de prueba del sistema Paraguay Impuestos.</p>",
    "<p>La integración con Gmail está funcionando correctamente.</p>",
    "<p><strong>No se ha presentado ningún formulario fiscal.</strong></p>"
  ].join("");
  const messageId = `test-${Date.now()}@paraguay-impuestos.local`;
  const raw = buildRawMessage({ ...config, subject, html, messageId });
  const response = await requestWithRetry(`${GMAIL_API}/messages/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ raw })
  }, dependencies);
  const payload = await response.json();
  return { sent: true, messageId: payload.id || "" };
}

async function sendPresentationConfirmation({
  period,
  results,
  stateFile,
  env = process.env
}, dependencies = {}) {
  const eventKey = `presentation-${periodKey(period)}`;
  const state = await loadState(stateFile);
  if (state[eventKey]?.status === "sent") {
    return { sent: false, skipped: true, reason: "already-sent" };
  }

  const config = await resolveGmailConfig(env);
  const accessToken = await getAccessToken(config, dependencies);
  const { subject, html } = buildPresentationEmail({ period, results });
  const messageId = `${eventKey}@paraguay-impuestos.local`;
  const raw = buildRawMessage({ ...config, subject, html, messageId });
  const response = await requestWithRetry(`${GMAIL_API}/messages/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ raw })
  }, dependencies);
  const payload = await response.json();
  state[eventKey] = {
    status: "sent",
    sent_at: new Date().toISOString(),
    gmail_message_id: payload.id || ""
  };
  await saveState(stateFile, state);
  return { sent: true, skipped: false, messageId: payload.id || "" };
}

export {
  buildPresentationEmail,
  escapeHtml,
  parseEnvText,
  resolveGmailConfig,
  sendPresentationConfirmation,
  sendTestEmail,
  verifyGmailConnection
};
