import { appendFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { displayPeriod, escapeHtml } from "./core.js";

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function activityPath() {
  if (process.env.TELEGRAM_ACTIVITY_LOG) return process.env.TELEGRAM_ACTIVITY_LOG;
  const directory = join(homedir(), "ai_projects/autofix-control-plane/logs/telegram-panel");
  return existsSync(directory) ? join(directory, "impuestos-paraguay-marangatu.jsonl") : "";
}

// Copia para el panel de agentes: una línea, un único write y best-effort.
function copyActivity(text, referencia) {
  try {
    const path = activityPath();
    if (!path) return;
    const nivel = /[❌🔴🚨⛔]/u.test(text) ? "error" : text.includes("⚠") ? "warning" : "ok";
    const texto = Buffer.from(text).subarray(0, 4096).toString("utf8").replace(/\ufffd+$/u, "");
    appendFileSync(path, `${JSON.stringify({
      ts: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      repo: "impuestos-paraguay-marangatu",
      host: process.env.TELEGRAM_ACTIVITY_HOST || "localhost",
      nivel,
      referencia,
      texto
    })}\n`);
  } catch {
    // La copia nunca afecta al envío.
  }
}

async function sendTelegramMessage(text, { token, chatId, referencia = "", fetchImpl = fetch } = {}) {
  const finalToken = token || process.env.MARANGATU_TELEGRAM_TOKEN;
  const finalChatId = chatId || process.env.MARANGATU_TELEGRAM_CHAT_ID;
  const ref = referencia ? ` ref=${referencia}` : "";

  if (!finalToken || !finalChatId) {
    console.log(`Telegram skipped (token/chat_id no configurados)${ref}.`);
    return false;
  }

  const url = `https://api.telegram.org/bot${finalToken}/sendMessage`;
  const body = JSON.stringify({
    chat_id: finalChatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true
  });

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(10000)
      });

      if (response.ok) {
        console.log(`Telegram enviado correctamente${ref}.`);
        copyActivity(text, referencia);
        return true;
      }

      const detail = await response.text().catch(() => "");
      if (response.status === 429 && attempt < 3) {
        console.log(`Telegram 429, esperando 10s antes de reintentar (intento ${attempt}/3).`);
        await sleep(10000);
        continue;
      }
      console.log(`Telegram fallo HTTP ${response.status}: ${detail.slice(0, 200)}`);
      return false;
    } catch (error) {
      console.log(`Telegram error de red (intento ${attempt}/3): ${error.message}`);
      if (attempt < 3) await sleep(5000);
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
    ? `Ejecución con errores para ${displayPeriod(period)}.`
    : mode === "submit"
      ? `Presentación completada correctamente para ${displayPeriod(period)}.`
      : `Dry run completado correctamente para ${displayPeriod(period)}. No se presentó ningún formulario.`;
  const lines = [`<b>[PARAGUAY IMPUESTOS]</b> ${escapeHtml(headline)}`];
  for (const result of results) {
    const detail = result.error
      ? ` — ${escapeHtml(result.error)}`
      : result.skippedReason
        ? ` (${escapeHtml(result.skippedReason)})`
        : "";
    lines.push(`${statusIcon(result)} <b>${escapeHtml(result.form)}</b>: ${escapeHtml(result.status)}${detail}`);
    if (result.justificante) {
      lines.push(`   Justificante: ${escapeHtml(result.justificante)}`);
    }
  }
  lines.push("", mode === "dry-run" ? "Modo: simulación segura" : "Modo: presentación real");
  return lines.join("\n");
}

export {
  buildResultSummary,
  sendTelegramMessage
};
