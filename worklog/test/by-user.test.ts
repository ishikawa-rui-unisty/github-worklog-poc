import assert from "node:assert/strict";
import test from "node:test";

import { aggregateByUser } from "../src/aggregate/by-user.js";
import type { WorkLog } from "../src/model/work-log.js";

const base: WorkLog = {
  commentId: 1,
  repository: "team/repo",
  issueNumber: 10,
  issueTitle: "Task",
  githubUser: "alice",
  workDate: "2026-09-01",
  hours: 1,
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
  commentUrl: "https://example.test/1",
};

test("adds multiple comments and distinguishes 0h from an unfilled past weekday", () => {
  const logs = [
    base,
    { ...base, commentId: 2, hours: 2 },
    { ...base, commentId: 3, workDate: "2026-09-02", hours: 0 },
    { ...base, commentId: 4, githubUser: "bob", hours: 10 },
  ];
  const users = [
    { githubUser: "alice", displayName: "Alice", aggregationTarget: true },
    { githubUser: "bob", displayName: "Bob", aggregationTarget: false },
  ];
  const result = aggregateByUser(logs, users, "2026/09", "Asia/Tokyo", new Date("2026-09-08T00:00:00Z"));
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].total, 3);
  assert.deepEqual(result.rows[0].days.slice(0, 3).map(({ hours, missing }) => ({ hours, missing })), [
    { hours: 3, missing: false },
    { hours: 0, missing: false },
    { hours: null, missing: true },
  ]);
  assert.equal(result.rows[0].days.find((day) => day.date === "2026-09-05")?.missing, false);
  assert.equal(result.rows[0].days.find((day) => day.date === "2026-09-08")?.missing, false);
  assert.equal(result.rows[0].days.find((day) => day.date === "2026-09-09")?.missing, false);
});

test("determines today in the configured timezone", () => {
  const result = aggregateByUser([], [{ githubUser: "alice", displayName: "Alice", aggregationTarget: true }],
    "2026-09", "Asia/Tokyo", new Date("2026-09-01T16:00:00Z"));
  assert.equal(result.rows[0].days[0].missing, true);
  assert.equal(result.rows[0].days[1].missing, false);
});

test("adds decimal hours without floating-point residue", () => {
  const result = aggregateByUser([
    { ...base, hours: 0.1 },
    { ...base, commentId: 2, hours: 0.2 },
  ], [{ githubUser: "alice", displayName: "Alice", aggregationTarget: true }],
  "2026-09", "Asia/Tokyo", new Date("2026-09-10T00:00:00Z"));
  assert.equal(result.rows[0].days[0].hours, 0.3);
  assert.equal(result.rows[0].total, 0.3);
});
