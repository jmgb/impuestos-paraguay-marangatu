import assert from "node:assert/strict";

import {
  LauncherError,
  effectiveConfig,
  parseLauncherArgs,
  validateLauncherConfig
} from "../scripts/run-supervised-submit.mjs";

assert.deepEqual(
  parseLauncherArgs([
    "--confirm-period", "2026-08",
    "--skip-f241",
    "--retry-error", "f120",
    "--check"
  ]),
  {
    confirmPeriod: "2026-08",
    checkOnly: true,
    forwardArgs: ["--skip-f241", "--retry-error", "F120"]
  }
);

assert.throws(
  () => parseLauncherArgs(["--force"]),
  error => error instanceof LauncherError && error.exitCode === 2
);

const validConfig = {
  MARANGATU_USER: "user",
  MARANGATU_PASSWORD: "password",
  MARANGATU_HEADLESS: "false"
};
assert.doesNotThrow(() => validateLauncherConfig({
  config: validConfig,
  confirmPeriod: "2026-08",
  expectedPeriod: "2026-08"
}));
assert.throws(
  () => validateLauncherConfig({
    config: validConfig,
    confirmPeriod: "2026-07",
    expectedPeriod: "2026-08"
  }),
  error => error instanceof LauncherError && error.exitCode === 5
);
assert.throws(
  () => validateLauncherConfig({
    config: { ...validConfig, MARANGATU_HEADLESS: "true" },
    confirmPeriod: "2026-08",
    expectedPeriod: "2026-08"
  }),
  error => error instanceof LauncherError && error.exitCode === 6
);

assert.throws(
  () => validateLauncherConfig({
    config: effectiveConfig(validConfig, { MARANGATU_HEADLESS: "true" }),
    confirmPeriod: "2026-08",
    expectedPeriod: "2026-08"
  }),
  error => error instanceof LauncherError && error.exitCode === 6,
  "una variable de entorno prevalece sobre el .env, como en dotenv"
);
assert.throws(
  () => validateLauncherConfig({
    config: { MARANGATU_USER: "user" },
    confirmPeriod: "2026-08",
    expectedPeriod: "2026-08"
  }),
  error => error instanceof LauncherError && error.exitCode === 4
);

console.log("Launcher tests passed.");
