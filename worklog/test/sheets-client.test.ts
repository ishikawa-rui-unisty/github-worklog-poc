import assert from "node:assert/strict";
import test from "node:test";

import { SheetsClient } from "../src/sheets/sheets-client.js";

test("writes 0h as a number and never clears manual sheets", async () => {
  const requests: { url: string; body: unknown }[] = [];
  const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
    const address = String(url);
    const body: unknown = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ url: address, body });
    if (address.endsWith("?fields=sheets(properties(sheetId,title))")) {
      return new Response(JSON.stringify({ sheets: ["WorkLogs", "Users", "Issues", "ByUser", "ByIssue", "Settings"]
        .map((title, sheetId) => ({ properties: { title, sheetId } })) }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  };
  const client = new SheetsClient("sheet", "token", fetcher as typeof fetch);
  const ids = await client.ensureSheets();
  await client.writeProjection(ids, [], [],
    { dates: ["2026-09-01"], rows: [{ githubUser: "alice", displayName: "Alice", total: 0,
      days: [{ date: "2026-09-01", hours: 0, weekend: false, missing: false }] }] },
    { dates: ["2026-09-01"], rows: [] });

  const clear = requests.find((request) => request.url.endsWith(":values:batchClear"));
  assert.deepEqual((clear?.body as { ranges: string[] }).ranges, ["WorkLogs", "Issues", "ByUser", "ByIssue"]);
  const write = requests.find((request) => request.url.endsWith(":values:batchUpdate"));
  const data = (write?.body as { data: { range: string; values: (string | number)[][] }[] }).data;
  assert.equal(data.find((sheet) => sheet.range === "ByUser!A1")?.values[1][2], 0);
  assert.equal(data.some((sheet) => sheet.range.startsWith("Users") || sheet.range.startsWith("Settings")), false);
});
