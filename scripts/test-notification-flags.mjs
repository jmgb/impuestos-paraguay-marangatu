import assert from "node:assert/strict";

import { notificationPolicy } from "../src/marangatu.js";

assert.deepEqual(
  notificationPolicy({
    submit: true,
    runError: undefined,
    hasNewPresentation: true,
    environment: {}
  }),
  {
    emailEnabled: false,
    telegramEnabled: false,
    sendEmail: false,
    sendTelegram: false
  },
  "las notificaciones deben estar desactivadas por defecto"
);

assert.equal(notificationPolicy({
  submit: true,
  runError: undefined,
  hasNewPresentation: true,
  environment: { MARANGATU_EMAIL_ENABLED: "true" }
}).sendEmail, true);

assert.equal(notificationPolicy({
  submit: false,
  runError: undefined,
  hasNewPresentation: true,
  environment: { MARANGATU_EMAIL_ENABLED: "true" }
}).sendEmail, false, "un dry-run nunca debe enviar email");

assert.equal(notificationPolicy({
  submit: false,
  runError: undefined,
  hasNewPresentation: false,
  environment: {
    MARANGATU_TELEGRAM_ENABLED: "true",
    MARANGATU_TELEGRAM_NOTIFY_DRY_RUN: "true"
  }
}).sendTelegram, true);

assert.equal(notificationPolicy({
  submit: false,
  runError: new Error("fallo de prueba"),
  hasNewPresentation: false,
  environment: {
    MARANGATU_TELEGRAM_ENABLED: "false",
    MARANGATU_TELEGRAM_NOTIFY_DRY_RUN: "true"
  }
}).sendTelegram, false, "el interruptor maestro debe prevalecer sobre el resto");

assert.equal(notificationPolicy({
  submit: false,
  runError: undefined,
  hasNewPresentation: false,
  environment: { MARANGATU_TELEGRAM_ENABLED: "true" }
}).sendTelegram, false, "un dry-run limpio no debe avisar sin su flag específico");

assert.equal(notificationPolicy({
  submit: false,
  runError: new Error("fallo de prueba"),
  hasNewPresentation: false,
  environment: { MARANGATU_TELEGRAM_ENABLED: "true" }
}).sendTelegram, true, "los errores deben avisarse cuando Telegram está habilitado");

console.log("Notification flag tests passed.");
