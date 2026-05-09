import assert from "node:assert/strict";

import {
  datePartsInTimeZone,
  previousMonthPeriod,
  targetPeriod
} from "../src/marangatu.js";

assert.deepEqual(
  datePartsInTimeZone(new Date("2026-05-01T10:00:00.000Z"), "Europe/Madrid"),
  { year: 2026, month: 5, day: 1 }
);

assert.deepEqual(
  previousMonthPeriod(new Date("2026-05-01T10:00:00.000Z"), "Europe/Madrid"),
  { year: 2026, month: 4 }
);

assert.deepEqual(
  previousMonthPeriod(new Date("2026-01-01T11:00:00.000Z"), "Europe/Madrid"),
  { year: 2025, month: 12 }
);

assert.deepEqual(
  targetPeriod({ year: 2026, month: 5 }),
  { year: 2026, month: 5 }
);

assert.throws(
  () => targetPeriod({ year: 2026 }),
  /--year y --month deben pasarse juntos/
);

assert.throws(
  () => targetPeriod({ year: 2026, month: 13 }),
  /Invalid month/
);

console.log("Period tests passed.");
