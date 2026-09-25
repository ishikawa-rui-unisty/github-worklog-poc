import assert from "node:assert/strict";
import test from "node:test";

import { parseWorkCommand } from "../src/parser/work-command-parser.js";

const createdAt = "2026-09-17T23:30:00Z";
const timezone = "Asia/Tokyo";

test("parses hours and derives a JST work date", () => {
  assert.deepEqual(parseWorkCommand("/work 2.5h", createdAt, timezone), {
    status: "valid",
    hours: 2.5,
    workDate: "2026-09-18",
    dateSpecified: false,
  });
});

test("accepts zero hours and upper-case H", () => {
  assert.deepEqual(parseWorkCommand("  /work 0H", createdAt, timezone), {
    status: "valid",
    hours: 0,
    workDate: "2026-09-18",
    dateSpecified: false,
  });
});

test("normalizes every accepted explicit date form", () => {
  for (const input of ["09/17", "09-17", "2025/09/17", "2025-09-17"]) {
    assert.deepEqual(parseWorkCommand(`/work 2h ${input}`, createdAt, timezone), {
      status: "valid",
      hours: 2,
      workDate: input.length === 5 ? "2026-09-17" : "2025-09-17",
      dateSpecified: true,
    });
  }
});

test("uses the created-at JST year for an abbreviated date without guessing", () => {
  assert.deepEqual(
    parseWorkCommand("/work 2h 12/31", "2027-01-02T00:00:00Z", timezone),
    { status: "valid", hours: 2, workDate: "2027-12-31", dateSpecified: true },
  );
});

test("ignores regular comments and inline references", () => {
  assert.deepEqual(parseWorkCommand("Please use /work 2h later.", createdAt, timezone), {
    status: "none",
  });
  assert.deepEqual(parseWorkCommand("/work2h", createdAt, timezone), { status: "none" });
});

test("reports invalid commands", () => {
  assert.deepEqual(parseWorkCommand("/work", createdAt, timezone), {
    status: "invalid",
    errorCode: "MISSING_HOURS",
  });
  assert.deepEqual(parseWorkCommand("/work -2h", createdAt, timezone), {
    status: "invalid",
    errorCode: "INVALID_HOURS",
  });
  assert.deepEqual(parseWorkCommand("/work 2h 2026/02/29", createdAt, timezone), {
    status: "invalid",
    errorCode: "INVALID_DATE",
  });
  assert.deepEqual(parseWorkCommand("/work 2h 09/17 extra", createdAt, timezone), {
    status: "invalid",
    errorCode: "TOO_MANY_ARGUMENTS",
  });
  assert.deepEqual(parseWorkCommand("/work 2h 2026/09-17", createdAt, timezone), {
    status: "invalid",
    errorCode: "INVALID_DATE",
  });
  assert.deepEqual(parseWorkCommand("/work 2h 2028/02/29", createdAt, timezone), {
    status: "valid",
    hours: 2,
    workDate: "2028-02-29",
    dateSpecified: true,
  });
});

test("rejects more than one command in a comment", () => {
  assert.deepEqual(parseWorkCommand("/work 1h\n/work 2h", createdAt, timezone), {
    status: "invalid",
    errorCode: "MULTIPLE_COMMANDS",
  });
});
