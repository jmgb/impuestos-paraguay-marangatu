import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildPresentationEmail,
  escapeHtml,
  sendPresentationConfirmation,
  sendTestEmail
} from "../src/email-notifier.js";

assert.equal(escapeHtml('a < b & "c"'), "a &lt; b &amp; &quot;c&quot;");

const period = { year: 2026, month: 8 };
const results = [
  { form: "F120", status: "presentado" },
  { form: "F241", status: "presentado" }
];
const content = buildPresentationEmail({ period, results });
assert.match(content.subject, /Presentación completada 08\/2026/);
assert.match(content.html, /<strong>F120<\/strong>: presentado/);
assert.match(content.html, /<strong>F241<\/strong>: presentado/);

const calls = [];
const fetchImpl = async (url, options) => {
  calls.push({ url, options });
  if (url.includes("oauth2.googleapis.com")) {
    return new Response(JSON.stringify({ access_token: "access" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }
  return new Response(JSON.stringify({ id: "gmail-message-1" }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
};

const temporaryDir = await fs.mkdtemp(path.join(os.tmpdir(), "marangatu-email-test-"));
const stateFile = path.join(temporaryDir, "email-state.json");
const env = {
  MARANGATU_GMAIL_CLIENT_ID: "client",
  MARANGATU_GMAIL_CLIENT_SECRET: "secret",
  MARANGATU_GMAIL_REFRESH_TOKEN: "refresh",
  MARANGATU_GMAIL_FROM: "sender@example.com",
  MARANGATU_GMAIL_TO: "recipient@example.com"
};

const first = await sendPresentationConfirmation({ period, results, stateFile, env }, { fetchImpl });
assert.equal(first.sent, true);
assert.equal(calls.length, 2);

const second = await sendPresentationConfirmation({ period, results, stateFile, env }, { fetchImpl });
assert.equal(second.skipped, true);
assert.equal(second.reason, "already-sent");
assert.equal(calls.length, 2, "la clave idempotente debe evitar un segundo envío");

const testResult = await sendTestEmail({ env }, { fetchImpl });
assert.equal(testResult.sent, true);
assert.equal(calls.length, 4, "el email de prueba debe renovar OAuth y realizar un envío independiente");
const testPayload = JSON.parse(calls.at(-1).options.body);
const decodedTestMessage = Buffer.from(testPayload.raw, "base64url").toString("utf8");
const encodedSubject = decodedTestMessage.match(/Subject: =\?UTF-8\?B\?([^?]+)\?=/)?.[1];
assert.ok(encodedSubject, "el asunto de prueba debe estar codificado como MIME UTF-8");
assert.match(Buffer.from(encodedSubject, "base64").toString("utf8"), /Prueba de confirmación/);
assert.doesNotMatch(decodedTestMessage, /Presentación completada 08\/2026/);

await fs.rm(temporaryDir, { recursive: true, force: true });
console.log("Email tests passed.");
