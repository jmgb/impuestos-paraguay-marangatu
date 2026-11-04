import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { sendTelegramMessage } from "../src/telegram.js";

const ok = async () => ({ ok: true, status: 200, text: async () => "" });
const options = { token: "t", chatId: "c", referencia: "sync" };

function withLog(run) {
  const log = join(mkdtempSync(join(tmpdir(), "activity-")), "copy.jsonl");
  process.env.TELEGRAM_ACTIVITY_LOG = log;
  delete process.env.TELEGRAM_ACTIVITY_HOST;
  return run(log).finally(() => delete process.env.TELEGRAM_ACTIVITY_LOG);
}

test("un envío entregado deja una línea para el panel", () => withLog(async log => {
  await sendTelegramMessage("❌ <b>fallo</b>", { ...options, fetchImpl: ok });
  const row = JSON.parse(readFileSync(log, "utf8"));
  assert.deepEqual(Object.keys(row).sort(), ["host", "nivel", "referencia", "repo", "texto", "ts"]);
  assert.equal(row.repo, "impuestos-paraguay-marangatu");
  assert.equal(row.host, "localhost");
  assert.equal(row.nivel, "error");
  assert.equal(row.referencia, "sync");
  assert.match(row.ts, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
}));

test("el texto se recorta a 4.096 bytes sin partir un carácter", () => withLog(async log => {
  await sendTelegramMessage("ñ".repeat(3000), { ...options, fetchImpl: ok });
  const { texto } = JSON.parse(readFileSync(log, "utf8"));
  assert.ok(Buffer.byteLength(texto) <= 4096);
  assert.ok(!texto.includes("\ufffd"));
}));

test("un envío rechazado no deja copia", () => withLog(async log => {
  const rejected = async () => ({ ok: false, status: 400, text: async () => "no" });
  await sendTelegramMessage("hola", { ...options, fetchImpl: rejected });
  assert.equal(existsSync(log), false);
}));

test("un fallo de la copia no rompe el envío", async () => {
  process.env.TELEGRAM_ACTIVITY_LOG = "/no/existe/copy.jsonl";
  try {
    assert.equal(await sendTelegramMessage("hola", { ...options, fetchImpl: ok }), true);
  } finally {
    delete process.env.TELEGRAM_ACTIVITY_LOG;
  }
});
