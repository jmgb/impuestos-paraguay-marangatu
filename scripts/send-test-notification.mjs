// Envía un mensaje de prueba por cada canal habilitado en .env (Telegram y
// Gmail) sin abrir Marangatu. Útil tras configurar credenciales o cambiar de
// máquina. No toca el estado de presentaciones ni la idempotencia del email.
import path from "node:path";

import dotenv from "dotenv";

import { booleanValue } from "../src/core.js";
import { sendTestEmail } from "../src/email-notifier.js";
import { rootDir } from "../src/state.js";
import { sendTelegramMessage } from "../src/telegram.js";

dotenv.config({ path: path.join(rootDir, ".env"), quiet: true });

let failed = false;

if (booleanValue(process.env.MARANGATU_TELEGRAM_ENABLED)) {
  const sent = await sendTelegramMessage(
    "<b>[PARAGUAY IMPUESTOS]</b> Mensaje de prueba. No se ha presentado ningún formulario.",
    { referencia: "notify-test" }
  );
  failed ||= !sent;
} else {
  console.log("Telegram desactivado (MARANGATU_TELEGRAM_ENABLED=false).");
}

if (booleanValue(process.env.MARANGATU_EMAIL_ENABLED)) {
  try {
    await sendTestEmail();
    console.log("Email de prueba enviado correctamente.");
  } catch (error) {
    console.log(`Email de prueba fallido: ${error.message}`);
    failed = true;
  }
} else {
  console.log("Email desactivado (MARANGATU_EMAIL_ENABLED=false).");
}

process.exitCode = failed ? 1 : 0;
