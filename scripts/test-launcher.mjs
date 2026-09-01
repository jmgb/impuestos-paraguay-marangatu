import assert from "node:assert/strict";

import {
  LauncherError,
  parseLauncherArgs,
  previousMonthStateKey,
  validateLauncherConfig
} from "./run-supervised-submit.mjs";

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

assert.equal(
  previousMonthStateKey(new Date("2026-01-15T12:00:00Z"), "Europe/Madrid"),
  "2025-12"
);
assert.equal(
  previousMonthStateKey(new Date("2026-09-01T10:00:00Z"), "Europe/Madrid"),
  "2026-08"
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

console.log("Launcher tests passed.");
