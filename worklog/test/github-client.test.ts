import assert from "node:assert/strict";
import test from "node:test";

import { GithubClient } from "../src/github/github-client.js";

test("reads all Project pages and only includes Issues from the configured repository", async () => {
  const bodies: unknown[] = [];
  const fetcher = async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    const page = bodies.length === 1
      ? { nodes: [{ content: { number: 1, repository: { nameWithOwner: "team/repo" } } },
          { content: { number: 2, repository: { nameWithOwner: "other/repo" } } }],
          pageInfo: { hasNextPage: true, endCursor: "next" } }
      : { nodes: [{ content: { number: 3, repository: { nameWithOwner: "team/repo" } } }],
          pageInfo: { hasNextPage: false, endCursor: null } };
    return new Response(JSON.stringify({ data: { organization: { projectV2: { items: page } } } }), { status: 200 });
  };
  const client = new GithubClient("token", "team", 1, "organization", fetcher as typeof fetch);
  assert.deepEqual([...await client.getTargetProjectIssueNumbers("team/repo")], [1, 3]);
  assert.equal((bodies[1] as { variables: { cursor: string } }).variables.cursor, "next");
});
