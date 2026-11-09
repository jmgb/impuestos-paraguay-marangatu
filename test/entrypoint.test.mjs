// Arranca el entrypoint real (carga Playwright y el resto de módulos) y
// comprueba que los controles de modo cortan antes de abrir el navegador.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const entrypoint = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/marangatu.js");

function run(args) {
  return spawnSync(process.execPath, [entrypoint, ...args], {
    encoding: "utf8",
    // El entorno prevalece sobre el .env local: sin interlock ni credenciales,
    // ningún caso puede llegar a iniciar sesión en el portal.
    env: { ...process.env, MARANGATU_SUBMIT: "false", MARANGATU_USER: "", MARANGATU_PASSWORD: "" },
    timeout: 30000
  });
}

const cases = [
  [["--desconocido"], /Argumento no reconocido/],
  [["--year", "2026"], /--year y --month deben pasarse juntos/],
  [["--submit", "--year", "2020", "--month", "1", "--confirm-period", "2020-01"], /MARANGATU_SUBMIT=true/],
  [["--confirm-period", "2020-01"], /solo puede usarse junto con --submit/],
  [["--submit", "--force", "--year", "2020", "--month", "1", "--confirm-period", "2020-01"], /--force solo puede usarse en dry-run/]
];

for (const [args, expected] of cases) {
  const result = run(args);
  assert.equal(result.status, 1, `${args.join(" ")} debe salir con código 1`);
  assert.match(result.stderr, expected);
  assert.doesNotMatch(result.stdout, /Opening Marangatu login/);
}

console.log("Entrypoint tests passed.");
