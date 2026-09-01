import assert from "node:assert/strict";

import { matchesPresentedDeclaration } from "../src/marangatu.js";

const period = { year: 2026, month: 8 };
const valid = {
  periodo: "08/2026",
  estado: "Procesado CC",
  formulario: "120-IVA GENERAL",
  activa: "S"
};

assert.equal(matchesPresentedDeclaration(valid, period, "120"), true);
assert.equal(matchesPresentedDeclaration({ ...valid, estado: "Aceptado" }, period, "120"), true);
assert.equal(matchesPresentedDeclaration({ ...valid, estado: "Rechazado" }, period, "120"), false);
assert.equal(matchesPresentedDeclaration({ ...valid, activa: "N" }, period, "120"), false);
assert.equal(matchesPresentedDeclaration({ ...valid, periodo: "07/2026" }, period, "120"), false);
assert.equal(matchesPresentedDeclaration({ ...valid, formulario: "121-IVA SEMESTRAL" }, period, "120"), false);

console.log("Verification tests passed.");
