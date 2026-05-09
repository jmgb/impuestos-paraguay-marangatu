import assert from "node:assert/strict";

import {
  escapeTelegramHtml,
  buildResultSummary,
  sendTelegramMessage
} from "../src/marangatu.js";

assert.equal(escapeTelegramHtml("a < b & c > d"), "a &lt; b &amp; c &gt; d");
assert.equal(escapeTelegramHtml(123), "123");

const okSummary = buildResultSummary({
  period: { year: 2026, month: 4 },
  mode: "submit",
  results: [
    { form: "F120", status: "presentado", justificante: "/abs/presentaciones/2026-04/F120.png" },
    { form: "F241", status: "presentado", justificante: "/abs/presentaciones/2026-04/F241.png" }
  ]
});
assert.match(okSummary, /\[MARANGATU\]/);
assert.match(okSummary, /Periodo 04\/2026/);
assert.match(okSummary, /✅ <b>F120<\/b>: presentado/);
assert.match(okSummary, /✅ <b>F241<\/b>: presentado/);
assert.match(okSummary, /Justificante: \/abs\/presentaciones\/2026-04\/F120\.png/);
assert.match(okSummary, /Justificante: \/abs\/presentaciones\/2026-04\/F241\.png/);
assert.match(okSummary, /Modo: submit/);

const errorSummary = buildResultSummary({
  period: { year: 2026, month: 4 },
  mode: "submit",
  results: [
    { form: "F120", status: "presentado" },
    { form: "F241", status: "error", error: "Botón <Aceptar> no apareció" }
  ]
});
assert.match(errorSummary, /❌ <b>F241<\/b>: error — Bot/);
assert.match(errorSummary, /&lt;Aceptar&gt;/);

const skippedSummary = buildResultSummary({
  period: { year: 2026, month: 5 },
  mode: "submit",
  results: [
    { form: "F120", status: "ya presentado", skipped: true, skippedReason: "already-presented" },
    { form: "F241", status: "saltado por flag", skipped: true, skippedReason: "skip flag" }
  ]
});
assert.match(skippedSummary, /⏭️ <b>F120<\/b>:.*\(already-presented\)/);
assert.match(skippedSummary, /⏭️ <b>F241<\/b>:.*\(skip flag\)/);

const previousToken = process.env.MARANGATU_TELEGRAM_TOKEN;
const previousChat = process.env.MARANGATU_TELEGRAM_CHAT_ID;
delete process.env.MARANGATU_TELEGRAM_TOKEN;
delete process.env.MARANGATU_TELEGRAM_CHAT_ID;
const sentNoConfig = await sendTelegramMessage("hola", { referencia: "test" });
assert.equal(sentNoConfig, false, "sin token/chat_id debe devolver false sin lanzar");
if (previousToken !== undefined) process.env.MARANGATU_TELEGRAM_TOKEN = previousToken;
if (previousChat !== undefined) process.env.MARANGATU_TELEGRAM_CHAT_ID = previousChat;

console.log("Telegram tests passed.");
