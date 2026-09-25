import type { ByIssue } from "../aggregate/by-issue.js";
import type { ByUser } from "../aggregate/by-user.js";
import type { IssueInfo } from "../model/issue.js";
import type { User } from "../model/user.js";
import type { WorkLog } from "../model/work-log.js";

type Cell = string | number | boolean;
type SheetName = "WorkLogs" | "Users" | "Issues" | "ByUser" | "ByIssue" | "Settings";
const SHEETS: SheetName[] = ["WorkLogs", "Users", "Issues", "ByUser", "ByIssue", "Settings"];

export class SheetsClient {
  constructor(private readonly spreadsheetId: string, private readonly accessToken: string,
    private readonly fetcher: typeof fetch = fetch) {}

  private async request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
    const response = await this.fetcher(`https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.accessToken}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error(`Google Sheets ${method} ${path}: ${response.status} ${await response.text()}`);
    return response.json() as Promise<T>;
  }

  /** 認証と Spreadsheet 参照だけを確認し、内容は変更しない。 */
  async listSheetNames(): Promise<string[]> {
    const metadata = await this.request<{ sheets?: { properties: { title: string } }[] }>(
      "?fields=sheets(properties(title))",
    );
    return (metadata.sheets ?? []).map((sheet) => sheet.properties.title);
  }

  /** 6 シートを用意する。手動管理シートが既にあれば変更しない。 */
  async ensureSheets(): Promise<Record<SheetName, number>> {
    const metadata = await this.request<{ sheets?: { properties: { sheetId: number; title: string } }[] }>(
      "?fields=sheets(properties(sheetId,title))",
    );
    const ids = new Map((metadata.sheets ?? []).map(({ properties }) => [properties.title, properties.sheetId]));
    const missing = SHEETS.filter((name) => !ids.has(name));
    if (missing.length) {
      const result = await this.request<{ replies: { addSheet?: { properties?: { sheetId: number } } }[] }>(
        ":batchUpdate", "POST", { requests: missing.map((name) => ({ addSheet: { properties: { title: name } } })) },
      );
      missing.forEach((name, index) => {
        const sheetId = result.replies[index]?.addSheet?.properties?.sheetId;
        if (sheetId === undefined) throw new Error(`Missing sheet ID for ${name}`);
        ids.set(name, sheetId);
      });
      const data = [];
      if (missing.includes("Users")) data.push({ range: "Users!A1:C1", values: [["github_user", "display_name", "aggregation_target"]] });
      if (missing.includes("Settings")) data.push({ range: "Settings!A1:B3", values: [["key", "value"], ["target_month", ""], ["timezone", "Asia/Tokyo"]] });
      if (data.length) await this.request(":values:batchUpdate", "POST", { valueInputOption: "RAW", data });
    }
    return Object.fromEntries(SHEETS.map((name) => [name, ids.get(name)])) as Record<SheetName, number>;
  }

  private async values(sheet: SheetName): Promise<Cell[][]> {
    const result = await this.request<{ values?: Cell[][] }>(`/values/${encodeURIComponent(`${sheet}!A:AZ`)}`);
    return result.values ?? [];
  }

  async readWorkLogs(): Promise<WorkLog[]> {
    const rows = await this.values("WorkLogs");
    return rows.slice(1).filter((row) => row[0] !== undefined && row[0] !== "").map((row) => {
      const commentId = Number(row[0]);
      const issueNumber = Number(row[2]);
      const hours = Number(row[6]);
      if (!Number.isSafeInteger(commentId) || !Number.isSafeInteger(issueNumber) || !Number.isFinite(hours)) {
        throw new Error("Invalid WorkLogs row");
      }
      return { commentId, repository: String(row[1]), issueNumber, issueTitle: String(row[3]),
        githubUser: String(row[4]), workDate: String(row[5]), hours,
        createdAt: String(row[7]), updatedAt: String(row[8]), commentUrl: String(row[9]) };
    });
  }

  async readUsers(): Promise<User[]> {
    const rows = await this.values("Users");
    return rows.slice(1).filter((row) => row[0]).map((row) => ({
      githubUser: String(row[0]), displayName: String(row[1] || row[0]),
      aggregationTarget: row[2] === true || String(row[2]).toUpperCase() === "TRUE",
    }));
  }

  async readSettings(): Promise<{ targetMonth: string | null; timezone: string }> {
    const rows = await this.values("Settings");
    const pairs = new Map(rows.slice(1).map((row) => [String(row[0]), String(row[1] ?? "")]));
    return { targetMonth: pairs.get("target_month") || null, timezone: pairs.get("timezone") || "Asia/Tokyo" };
  }

  /** 出力データを先に組み立て、システム管理シートだけを上書きする。 */
  async writeProjection(sheetIds: Record<SheetName, number>, workLogs: readonly WorkLog[],
    issues: readonly IssueInfo[], byUser: ByUser, byIssue: ByIssue): Promise<void> {
    const values: { range: string; values: Cell[][] }[] = [
      { range: "WorkLogs!A1", values: [
        ["comment_id", "repository", "issue_number", "issue_title", "github_user", "work_date", "hours", "created_at", "updated_at", "comment_url"],
        ...workLogs.map((log) => [log.commentId, log.repository, log.issueNumber, log.issueTitle, log.githubUser,
          log.workDate, log.hours, log.createdAt, log.updatedAt, log.commentUrl]),
      ] },
      { range: "Issues!A1", values: [
        ["repository", "issue_number", "title", "parent_issue_number", "level", "state", "in_project", "issue_url"],
        ...issues.map((issue) => [issue.repository, issue.issueNumber, issue.title, issue.parentIssueNumber ?? "",
          issue.level, issue.state, issue.inProject, issue.issueUrl]),
      ] },
      { range: "ByUser!A1", values: [
        ["github_user", "display_name", ...byUser.dates, "Total"],
        ...byUser.rows.map((row) => [row.githubUser, row.displayName, ...row.days.map((day) => day.hours ?? ""), row.total]),
      ] },
      { range: "ByIssue!A1", values: [
        ["repository", "issue_number", "title", "level", "state", "in_project", ...byIssue.dates, "Direct", "Total"],
        ...byIssue.rows.map((row) => [row.issue.repository, row.issue.issueNumber, row.issue.title, row.issue.level,
          row.issue.state, row.issue.inProject, ...row.days.map((day) => day.hours ?? ""), row.direct, row.total]),
      ] },
    ];

    await this.request(":values:batchClear", "POST", {
      ranges: ["WorkLogs", "Issues", "ByUser", "ByIssue"],
    });
    await this.request(":values:batchUpdate", "POST", { valueInputOption: "RAW", data: values });

    // ByUser の日付領域をリセットしてから、週末と未入力を着色する。
    const userSheetId = sheetIds.ByUser;
    const endRow = Math.max(byUser.rows.length + 1, 2);
    const requests: object[] = [{ repeatCell: { range: { sheetId: userSheetId, startRowIndex: 1,
      endRowIndex: endRow, startColumnIndex: 2, endColumnIndex: byUser.dates.length + 2 },
      cell: { userEnteredFormat: { backgroundColor: { red: 1, green: 1, blue: 1 } } },
      fields: "userEnteredFormat.backgroundColor" } }];
    byUser.dates.forEach((date, index) => {
      if (byUser.rows[0]?.days[index]?.weekend) {
        requests.push({ repeatCell: { range: { sheetId: userSheetId, startRowIndex: 1,
          endRowIndex: endRow, startColumnIndex: index + 2, endColumnIndex: index + 3 },
          cell: { userEnteredFormat: { backgroundColor: { red: 0.9, green: 0.9, blue: 0.9 } } },
          fields: "userEnteredFormat.backgroundColor" } });
      }
    });
    byUser.rows.forEach((row, rowIndex) => row.days.forEach((day, dayIndex) => {
      if (day.missing) requests.push({ repeatCell: { range: { sheetId: userSheetId,
        startRowIndex: rowIndex + 1, endRowIndex: rowIndex + 2,
        startColumnIndex: dayIndex + 2, endColumnIndex: dayIndex + 3 },
        cell: { userEnteredFormat: { backgroundColor: { red: 1, green: 0.95, blue: 0.6 } } },
        fields: "userEnteredFormat.backgroundColor" } });
    }));
    await this.request(":batchUpdate", "POST", { requests });
  }
}
