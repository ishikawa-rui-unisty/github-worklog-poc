import assert from "node:assert/strict";
import test from "node:test";

import { aggregateByIssue } from "../src/aggregate/by-issue.js";
import type { IssueInfo } from "../src/model/issue.js";
import type { WorkLog } from "../src/model/work-log.js";

function issue(issueNumber: number, parentIssueNumber: number | null, level: number): IssueInfo {
  return {
    repository: "team/repo",
    issueNumber,
    title: `Issue ${issueNumber}`,
    parentIssueNumber,
    level,
    state: issueNumber === 111 ? "closed" : "open",
    inProject: issueNumber !== 100,
    issueUrl: `https://example.test/issues/${issueNumber}`,
  };
}

function log(commentId: number, issueNumber: number, hours: number, workDate = "2026-09-01"): WorkLog {
  return {
    commentId,
    repository: "team/repo",
    issueNumber,
    issueTitle: `Issue ${issueNumber}`,
    githubUser: "alice",
    workDate,
    hours,
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    commentUrl: `https://example.test/comments/${commentId}`,
  };
}

test("rolls up all descendants and the parent's own hours in DFS order", () => {
  const issues = [issue(111, 110, 2), issue(100, null, 0), issue(120, 100, 1), issue(110, 100, 1)];
  const logs = [log(1, 100, 1), log(2, 110, 2), log(3, 111, 5), log(4, 120, 4), log(5, 111, 0), log(6, 111, 100, "2026-08-31")];
  const rows = aggregateByIssue(logs, issues, "2026/09").rows;
  assert.deepEqual(rows.map((row) => row.issue.issueNumber), [100, 110, 111, 120]);
  assert.deepEqual(rows.map(({ direct, total }) => ({ direct, total })), [
    { direct: 1, total: 12 },
    { direct: 2, total: 7 },
    { direct: 5, total: 5 },
    { direct: 4, total: 4 },
  ]);
  assert.equal(rows[0].days[0].hours, 12);
  assert.equal(rows[0].issue.inProject, false);
  assert.equal(rows[2].issue.state, "closed");
});

test("keeps a direct 0h entry distinct from an empty day", () => {
  const row = aggregateByIssue([log(1, 111, 0)], [issue(111, null, 0)], "2026-09").rows[0];
  assert.equal(row.days[0].hours, 0);
  assert.equal(row.days[1].hours, null);
});

test("rejects incomplete and circular hierarchies", () => {
  assert.throws(() => aggregateByIssue([], [issue(110, 100, 1)], "2026-09"), /Parent Issue is missing/);
  assert.throws(() => aggregateByIssue([], [issue(100, 110, 0), issue(110, 100, 1)], "2026-09"), /Circular Issue hierarchy/);
});

test("adds decimal hours exactly across the Issue hierarchy", () => {
  const rows = aggregateByIssue(
    [log(1, 100, 0.1), log(2, 110, 0.2)],
    [issue(100, null, 0), issue(110, 100, 1)], "2026-09",
  ).rows;
  assert.equal(rows[0].days[0].hours, 0.3);
  assert.equal(rows[0].total, 0.3);
  assert.equal(rows[1].direct, 0.2);
});
