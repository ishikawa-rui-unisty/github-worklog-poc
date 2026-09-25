import assert from "node:assert/strict";
import test from "node:test";

import type { WorkLog } from "../src/model/work-log.js";
import { syncWorkLog } from "../src/sync/work-log-sync.js";

const original: WorkLog = {
  commentId: 101,
  repository: "team/repo",
  issueNumber: 10,
  issueTitle: "Task",
  githubUser: "alice",
  workDate: "2026-09-17",
  hours: 2,
  createdAt: "2026-09-17T00:00:00Z",
  updatedAt: "2026-09-17T00:00:00Z",
  commentUrl: "https://example.test/101",
};

test("upserts by comment ID and remains unchanged when replayed", () => {
  const inserted = syncWorkLog([], 101, original);
  assert.deepEqual(inserted, [original]);
  assert.deepEqual(syncWorkLog(inserted, 101, original), inserted);

  const edited = { ...original, hours: 3, workDate: "2026-09-18" };
  assert.deepEqual(syncWorkLog(inserted, 101, edited), [edited]);
});

test("removes an invalidated or deleted comment without touching other logs", () => {
  const other = { ...original, commentId: 102 };
  assert.deepEqual(syncWorkLog([original, other], 101, null), [other]);
  assert.deepEqual(syncWorkLog([other], 101, null), [other]);
});

test("rejects a replacement with the wrong comment ID", () => {
  assert.throws(() => syncWorkLog([], 101, { ...original, commentId: 102 }));
});
