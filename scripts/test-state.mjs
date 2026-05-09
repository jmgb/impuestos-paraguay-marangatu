import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  periodStateKey,
  loadFormState,
  saveFormState,
  getFormStatus,
  setFormStatus,
  runFormWithStateTracking
} from "../src/marangatu.js";

const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "marangatu-state-"));
const stateFile = path.join(tmpRoot, "forms.json");

assert.equal(periodStateKey({ year: 2026, month: 4 }), "2026-04");
assert.equal(periodStateKey({ year: 2025, month: 12 }), "2025-12");

assert.deepEqual(await loadFormState(stateFile), {});
assert.equal(await getFormStatus({ year: 2026, month: 4 }, "F120", stateFile), null);

await setFormStatus({ year: 2026, month: 4 }, "F120", "iniciado", {}, stateFile);
let status = await getFormStatus({ year: 2026, month: 4 }, "F120", stateFile);
assert.equal(status.status, "iniciado");
assert.match(status.updated_at, /^\d{4}-\d{2}-\d{2}T/);

await setFormStatus({ year: 2026, month: 4 }, "F120", "presentado", {}, stateFile);
status = await getFormStatus({ year: 2026, month: 4 }, "F120", stateFile);
assert.equal(status.status, "presentado");

await setFormStatus({ year: 2026, month: 4 }, "F241", "error", { error: "boom" }, stateFile);
const wholeState = await loadFormState(stateFile);
assert.equal(wholeState["2026-04"].F120.status, "presentado");
assert.equal(wholeState["2026-04"].F241.status, "error");
assert.equal(wholeState["2026-04"].F241.error, "boom");

await saveFormState({}, stateFile);

let calls = 0;
const okResult = await runFormWithStateTracking({
  formName: "F120",
  period: { year: 2026, month: 4 },
  submit: true,
  force: false,
  fn: async () => { calls += 1; return "ok"; }
});
assert.equal(okResult, "ok");
assert.equal(calls, 1);
assert.equal((await getFormStatus({ year: 2026, month: 4 }, "F120")).status, "presentado");

const skipped = await runFormWithStateTracking({
  formName: "F120",
  period: { year: 2026, month: 4 },
  submit: true,
  force: false,
  fn: async () => { calls += 1; }
});
assert.equal(calls, 1, "fn must not run when state already presentado");
assert.deepEqual(skipped, { skipped: true, reason: "already-presented" });

let dryRunCalls = 0;
await runFormWithStateTracking({
  formName: "F120",
  period: { year: 2026, month: 4 },
  submit: false,
  force: false,
  fn: async () => { dryRunCalls += 1; }
});
assert.equal(dryRunCalls, 1, "dry-run runs even if state says presentado");

await setFormStatus({ year: 2026, month: 5 }, "F241", "error", { error: "previous" });
await assert.rejects(
  () => runFormWithStateTracking({
    formName: "F241",
    period: { year: 2026, month: 5 },
    submit: true,
    force: false,
    fn: async () => {}
  }),
  /estado 'error' previo/
);

let forcedCalls = 0;
await runFormWithStateTracking({
  formName: "F241",
  period: { year: 2026, month: 5 },
  submit: true,
  force: true,
  fn: async () => { forcedCalls += 1; }
});
assert.equal(forcedCalls, 1);
assert.equal((await getFormStatus({ year: 2026, month: 5 }, "F241")).status, "presentado");

await setFormStatus({ year: 2026, month: 6 }, "F120", "iniciado");
await assert.rejects(
  () => runFormWithStateTracking({
    formName: "F120",
    period: { year: 2026, month: 6 },
    submit: true,
    force: true,
    fn: async () => { throw new Error("portal failure"); }
  }),
  /portal failure/
);
const failed = await getFormStatus({ year: 2026, month: 6 }, "F120");
assert.equal(failed.status, "error");
assert.equal(failed.error, "portal failure");

await fs.rm(tmpRoot, { recursive: true, force: true });
await fs.rm(path.resolve(".state"), { recursive: true, force: true });

console.log("State tests passed.");
