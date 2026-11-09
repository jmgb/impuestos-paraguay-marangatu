import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { parseArgs, periodStateKey, previousMonthPeriod, resolveRunMode } from "../src/core.js";
import * as state from "../src/state.js";
import * as app from "../src/marangatu.js";

const period = { year: 2026, month: 10 };

test("daily retries require all three submission interlocks", () => {
  const args = parseArgs(["--retry-pending"]);
  assert.equal(args.retryPending, true);
  assert.throws(() => resolveRunMode(args, period, {}), /solo puede usarse junto con --submit/);
  args.submit = true;
  assert.throws(() => resolveRunMode(args, period, {}), /MARANGATU_SUBMIT=true/);
  assert.throws(() => resolveRunMode(args, period, { MARANGATU_SUBMIT: "true" }), /--confirm-period 2026-10/);
  args.confirmPeriod = "2026-10";
  assert.equal(resolveRunMode(args, period, { MARANGATU_SUBMIT: "true" }), "submit");
});

test("daily plan only retries unfinished forms in the previous Madrid month", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "marangatu-daily-"));
  const file = path.join(tmp, "forms.json");
  try {
    assert.equal(typeof state.pendingFormsForPeriod, "function");
    assert.deepEqual(await state.pendingFormsForPeriod(period, file), ["F120", "F241"]);
    for (const status of ["error", "iniciado"]) {
      await state.saveFormState({ "2026-10": { F120: { status: "presentado" }, F241: { status } } }, file);
      assert.deepEqual(await state.pendingFormsForPeriod(period, file), ["F241"]);
    }
    await state.setFormStatus(period, "F241", "sin-pendientes", {}, file);
    assert.deepEqual(await state.pendingFormsForPeriod(period, file), []);
    const nextMonth = previousMonthPeriod(new Date("2026-12-01T11:00:00Z"));
    assert.deepEqual(await state.pendingFormsForPeriod(nextMonth, file), ["F120", "F241"]);
    const january = previousMonthPeriod(new Date("2027-01-01T11:00:00Z"));
    assert.equal(periodStateKey(january), "2026-12");
    assert.deepEqual(await state.pendingFormsForPeriod(january, file), ["F120", "F241"]);
    await fs.writeFile(file, "broken json");
    await assert.rejects(() => state.pendingFormsForPeriod(period, file), SyntaxError);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("a completed scheduled month exits without a browser, login or notifications", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "marangatu-complete-"));
  const file = path.join(tmp, "forms.json");
  const previousSubmit = process.env.MARANGATU_SUBMIT;
  try {
    const currentPeriod = previousMonthPeriod();
    await state.saveFormState({
      [periodStateKey(currentPeriod)]: { F120: { status: "presentado" }, F241: { status: "sin-pendientes" } }
    }, file);
    const before = await fs.readFile(file, "utf8");
    process.env.MARANGATU_SUBMIT = "true";
    assert.equal(typeof app.main, "function");
    await app.main(["--submit", "--retry-pending", "--confirm-period", periodStateKey(currentPeriod)], {
      stateFilePath: file,
      launchBrowser: () => { assert.fail("must not launch browser for a completed month"); }
    });
    assert.equal(await fs.readFile(file, "utf8"), before, "completed state must remain unchanged");
  } finally {
    if (previousSubmit === undefined) delete process.env.MARANGATU_SUBMIT;
    else process.env.MARANGATU_SUBMIT = previousSubmit;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("an incomplete month reaches the browser again; explicitly skipped forms do not", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "marangatu-retry-"));
  const file = path.join(tmp, "forms.json");
  const previousSubmit = process.env.MARANGATU_SUBMIT;
  const currentPeriod = previousMonthPeriod();
  const args = ["--submit", "--retry-pending", "--confirm-period", periodStateKey(currentPeriod)];
  const stopped = new Error("test stops before opening a real browser");
  let launches = 0;
  const options = { stateFilePath: file, launchBrowser: () => { launches += 1; throw stopped; } };
  try {
    process.env.MARANGATU_SUBMIT = "true";
    for (const formStates of [
      {},
      { F120: { status: "error" }, F241: { status: "error" } },
      { F120: { status: "presentado" }, F241: { status: "error" } },
      { F120: { status: "iniciado" }, F241: { status: "sin-pendientes" } }
    ]) {
      await state.saveFormState({ [periodStateKey(currentPeriod)]: formStates }, file);
      await assert.rejects(() => app.main(args, options), error => error === stopped);
    }
    assert.equal(launches, 4);
    await state.saveFormState({
      [periodStateKey(currentPeriod)]: { F120: { status: "presentado" }, F241: { status: "error" } }
    }, file);
    await app.main([...args, "--skip-f241"], options);
    assert.equal(launches, 4);
    await fs.writeFile(file, "broken json");
    await assert.rejects(() => app.main(args, options), SyntaxError);
    assert.equal(launches, 4, "corrupt state must stop before browser launch");
    await assert.rejects(() => app.main(["--dry-run"], options), error => error === stopped);
    assert.equal(launches, 5, "dry-run must not read submission state");
  } finally {
    if (previousSubmit === undefined) delete process.env.MARANGATU_SUBMIT;
    else process.env.MARANGATU_SUBMIT = previousSubmit;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
