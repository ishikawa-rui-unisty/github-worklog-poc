import assert from "node:assert/strict";
import test from "node:test";

import { getWorklogConfig } from "../src/config.js";

test("defaults to Asia/Tokyo and rejects an invalid timezone", () => {
  assert.deepEqual(getWorklogConfig({}), { timezone: "Asia/Tokyo" });
  assert.throws(() => getWorklogConfig({ WORKLOG_TIMEZONE: "Mars/Olympus" }));
});
