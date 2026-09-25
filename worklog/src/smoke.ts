import { getConnectionConfig } from "./config.js";
import { GithubClient } from "./github/github-client.js";
import { SheetsClient } from "./sheets/sheets-client.js";

/** Project と Spreadsheet の読み取りだけを確認する。 */
async function main(): Promise<void> {
  const config = getConnectionConfig();
  const github = new GithubClient(config.githubToken, config.projectOwner,
    config.projectNumber, config.projectOwnerType);
  const sheets = new SheetsClient(config.spreadsheetId, config.googleAccessToken);
  const [issueNumbers, sheetNames] = await Promise.all([
    github.getTargetProjectIssueNumbers(config.repository),
    sheets.listSheetNames(),
  ]);
  console.log(`GitHub Project: ${issueNumbers.size} Issue(s) in ${config.repository}`);
  console.log(`Google Sheets: ${sheetNames.join(", ") || "no sheets"}`);
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
