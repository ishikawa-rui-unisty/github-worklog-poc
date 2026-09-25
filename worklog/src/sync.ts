import { readFile } from "node:fs/promises";

import { aggregateByIssue } from "./aggregate/by-issue.js";
import { aggregateByUser } from "./aggregate/by-user.js";
import { localDate } from "./aggregate/dates.js";
import { getRuntimeConfig, type RuntimeConfig } from "./config.js";
import { GithubClient } from "./github/github-client.js";
import type { IssueInfo } from "./model/issue.js";
import type { WorkLog } from "./model/work-log.js";
import { parseWorkCommand, type WorkCommandError } from "./parser/work-command-parser.js";
import { SheetsClient } from "./sheets/sheets-client.js";
import { syncWorkLog } from "./sync/work-log-sync.js";

type IssueCommentPayload = {
  action: "created" | "edited" | "deleted";
  repository: { full_name: string };
  issue: { number: number; pull_request?: unknown };
  comment: { id: number };
};

const ERROR_MESSAGES: Record<WorkCommandError, string> = {
  MULTIPLE_COMMANDS: "1つのコメントには1件の工数のみ登録できます。",
  MISSING_HOURS: "工数を指定してください。例: /work 2.5h",
  INVALID_HOURS: "工数を認識できません。例: /work 2.5h",
  INVALID_DATE: "日付を認識できません。例: /work 2.5h 09/17",
  TOO_MANY_ARGUMENTS: "入力形式を確認してください。例: /work 2.5h 09/17",
};

/** 現在の Project Issue、WorkLog Issue とその祖先を取得する。 */
export async function collectIssueInfos(github: GithubClient, repository: string,
  projectNumbers: ReadonlySet<number>, workLogs: readonly WorkLog[]): Promise<IssueInfo[]> {
  const cache = new Map<number, IssueInfo>();
  const visiting = new Set<number>();
  async function visit(number: number): Promise<IssueInfo> {
    const cached = cache.get(number);
    if (cached) return cached;
    if (visiting.has(number)) throw new Error(`CIRCULAR_ISSUE_HIERARCHY: #${number}`);
    visiting.add(number);
    const issue = await github.getIssueInfo(repository, number, projectNumbers.has(number));
    if (issue.parentIssueNumber !== null) {
      const parent = await visit(issue.parentIssueNumber);
      issue.level = parent.level + 1;
    }
    visiting.delete(number);
    cache.set(number, issue);
    return issue;
  }
  const numbers = new Set([...projectNumbers, ...workLogs.map((log) => log.issueNumber)]);
  for (const number of numbers) await visit(number);
  return [...cache.values()];
}

/** イベント順序ではなく、GitHub 上のコメントの現在状態で同期する。 */
export async function syncComment(payload: IssueCommentPayload, config: RuntimeConfig,
  github = new GithubClient(config.githubToken, config.projectOwner, config.projectNumber, config.projectOwnerType),
  sheets = new SheetsClient(config.spreadsheetId, config.googleAccessToken)): Promise<void> {
  if (payload.repository.full_name !== config.repository) throw new Error("Event repository does not match configuration");
  if (payload.issue.pull_request) return;
  if (!["created", "edited", "deleted"].includes(payload.action)) return;

  const sheetIds = await sheets.ensureSheets();
  const current = await sheets.readWorkLogs();
  const commentId = payload.comment.id;
  const comment = payload.action === "deleted" ? null : await github.getComment(config.repository, commentId);
  const parsed = comment ? parseWorkCommand(comment.body ?? "", comment.created_at, config.timezone) : { status: "none" as const };

  // Bot の通常コメントなど、工数に関係しないイベントはここで終了する。
  if (parsed.status === "none" && !current.some((log) => log.commentId === commentId)) return;

  let next: WorkLog | null = null;
  let feedback: "success" | string | null = null;
  let projectNumbers: Set<number> | null = null;
  if (parsed.status === "invalid") {
    feedback = ERROR_MESSAGES[parsed.errorCode];
  } else if (parsed.status === "valid" && comment) {
    projectNumbers = await github.getTargetProjectIssueNumbers(config.repository);
    if (!projectNumbers.has(payload.issue.number)) {
      feedback = "このIssueは工数管理対象のProjectに登録されていません。";
    } else {
      const issue = await github.getIssue(config.repository, payload.issue.number);
      if (!comment.user) throw new Error(`Comment ${commentId} has no user`);
      next = { commentId, repository: config.repository, issueNumber: payload.issue.number,
        issueTitle: issue.title, githubUser: comment.user.login, workDate: parsed.workDate,
        hours: parsed.hours, createdAt: comment.created_at, updatedAt: comment.updated_at,
        commentUrl: comment.html_url };
      feedback = "success";
    }
  }

  const updated = syncWorkLog(current, commentId, next);
  if (JSON.stringify(updated) !== JSON.stringify(current)) {
    const [users, settings] = await Promise.all([sheets.readUsers(), sheets.readSettings()]);
    projectNumbers ??= await github.getTargetProjectIssueNumbers(config.repository);
    const issues = await collectIssueInfos(github, config.repository, projectNumbers, updated);
    const targetMonth = settings.targetMonth ?? localDate(new Date(), settings.timezone).slice(0, 7);
    const byUser = aggregateByUser(updated, users, targetMonth, settings.timezone);
    const byIssue = aggregateByIssue(updated, issues, targetMonth);
    await sheets.writeProjection(sheetIds, updated, issues, byUser, byIssue);
  }

  // Sheets の書込みが成功してから利用者へ通知する。
  if (feedback === "success") await github.addSuccessReaction(config.repository, commentId);
  else if (feedback) await github.postValidationError(config.repository, payload.issue.number,
    `⚠️ 工数を登録できませんでした。${feedback}`);
}

async function main(): Promise<void> {
  const config = getRuntimeConfig();
  const payload = JSON.parse(await readFile(config.eventPath, "utf8")) as IssueCommentPayload;
  await syncComment(payload, config);
}

if (process.argv[1]?.endsWith("sync.js")) {
  main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
}
