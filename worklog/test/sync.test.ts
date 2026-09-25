import assert from "node:assert/strict";
import test from "node:test";

import type { RuntimeConfig } from "../src/config.js";
import type { GithubClient } from "../src/github/github-client.js";
import type { SheetsClient } from "../src/sheets/sheets-client.js";
import { syncComment } from "../src/sync.js";

const config: RuntimeConfig = {
  repository: "team/repo", projectOwner: "team", projectOwnerType: "organization",
  projectNumber: 1, spreadsheetId: "sheet", githubToken: "token",
  googleAccessToken: "token", eventPath: "event.json", timezone: "Asia/Tokyo",
};
const payload = {
  action: "created" as const, repository: { full_name: "team/repo" },
  issue: { number: 10 }, comment: { id: 101 },
};

test("writes a valid comment before adding a success reaction", async () => {
  const events: string[] = [];
  const github = {
    getComment: async () => ({ id: 101, body: "/work 1.239h", user: { login: "alice" },
      created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z", html_url: "url" }),
    getTargetProjectIssueNumbers: async () => new Set([10]),
    getIssue: async () => ({ title: "Task" }),
    getIssueInfo: async () => ({ repository: "team/repo", issueNumber: 10, title: "Task",
      parentIssueNumber: null, level: 0, state: "open", inProject: true, issueUrl: "url" }),
    addSuccessReaction: async () => { events.push("reaction"); },
  } as unknown as GithubClient;
  const sheets = {
    ensureSheets: async () => ({}),
    readWorkLogs: async () => [],
    readUsers: async () => [{ githubUser: "alice", displayName: "Alice", aggregationTarget: true }],
    readSettings: async () => ({ targetMonth: "2026/09", timezone: "Asia/Tokyo" }),
    writeProjection: async (_ids: unknown, logs: { hours: number }[]) => {
      assert.equal(logs[0].hours, 1.23);
      events.push("sheets");
    },
  } as unknown as SheetsClient;
  await syncComment(payload, config, github, sheets);
  assert.deepEqual(events, ["sheets", "reaction"]);
});

test("removes an existing WorkLog when the edited command becomes invalid", async () => {
  const events: string[] = [];
  const github = {
    getComment: async () => ({ id: 101, body: "/work abc", user: { login: "alice" },
      created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z", html_url: "url" }),
    getTargetProjectIssueNumbers: async () => new Set([10]),
    getIssueInfo: async () => ({ repository: "team/repo", issueNumber: 10, title: "Task",
      parentIssueNumber: null, level: 0, state: "open", inProject: true, issueUrl: "url" }),
    postValidationError: async () => { events.push("error-comment"); },
  } as unknown as GithubClient;
  const sheets = {
    ensureSheets: async () => ({}),
    readWorkLogs: async () => [{ commentId: 101, repository: "team/repo", issueNumber: 10,
      issueTitle: "Task", githubUser: "alice", workDate: "2026-09-01", hours: 2,
      createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z", commentUrl: "url" }],
    readUsers: async () => [],
    readSettings: async () => ({ targetMonth: "2026/09", timezone: "Asia/Tokyo" }),
    writeProjection: async (_ids: unknown, logs: unknown[]) => {
      assert.equal(logs.length, 0);
      events.push("sheets");
    },
  } as unknown as SheetsClient;
  await syncComment({ ...payload, action: "edited" }, config, github, sheets);
  assert.deepEqual(events, ["sheets", "error-comment"]);
});
