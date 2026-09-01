import assert from "node:assert/strict";

import {
  parseArgs,
  resolveRunMode
} from "../src/marangatu.js";

const period = { year: 2026, month: 8 };

assert.equal(resolveRunMode(parseArgs([]), period, {}), "dry-run");
assert.equal(resolveRunMode(parseArgs(["--dry-run"]), period, {}), "dry-run");
assert.equal(
  resolveRunMode(parseArgs([]), period, { MARANGATU_SUBMIT: "true" }),
  "dry-run",
  "la variable de entorno sola nunca debe activar una presentación"
);

assert.throws(
  () => resolveRunMode(parseArgs(["--dry-run", "--submit"]), period, { MARANGATU_SUBMIT: "true" }),
  /modos excluyentes/
);

assert.throws(
  () => resolveRunMode(parseArgs(["--submit", "--confirm-period", "2026-08"]), period, {}),
  /MARANGATU_SUBMIT=true/
);

assert.throws(
  () => resolveRunMode(parseArgs(["--submit"]), period, { MARANGATU_SUBMIT: "true" }),
  /--confirm-period 2026-08/
);

assert.throws(
  () => resolveRunMode(parseArgs(["--submit", "--confirm-period", "2026-07"]), period, { MARANGATU_SUBMIT: "true" }),
  /--confirm-period 2026-08/
);

assert.equal(
  resolveRunMode(
    parseArgs(["--submit", "--confirm-period", "2026-08"]),
    period,
    { MARANGATU_SUBMIT: "true" }
  ),
  "submit"
);

assert.throws(
  () => resolveRunMode(parseArgs(["--confirm-period", "2026-08"]), period, {}),
  /solo puede usarse junto con --submit/
);

assert.throws(() => parseArgs(["--desconocido"]), /Argumento no reconocido/);
assert.throws(() => parseArgs(["--confirm-period"]), /Falta el valor/);
assert.throws(() => parseArgs(["--retry-error", "F999"]), /solo acepta F120 o F241/);
assert.throws(
  () => resolveRunMode(parseArgs(["--retry-error", "F120"]), period, {}),
  /solo puede usarse junto con --submit/
);

console.log("Mode tests passed.");
