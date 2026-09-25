import type { IssueInfo } from "../model/issue.js";
import type { WorkLog } from "../model/work-log.js";
import { addHundredths, fromHundredths, toHundredths } from "../model/hours.js";
import { datesInMonth } from "./dates.js";

export type IssueDay = { date: string; hours: number | null };

export type IssueRow = {
  issue: IssueInfo;
  days: IssueDay[];
  direct: number;
  total: number;
};

export type ByIssue = { dates: string[]; rows: IssueRow[] };

function issueKey(repository: string, issueNumber: number): string {
  return `${repository}#${issueNumber}`;
}

/** 現在の Issue 階層で、対象月の直接工数と子孫込み工数を計算する。 */
export function aggregateByIssue(
  workLogs: readonly WorkLog[],
  issues: readonly IssueInfo[],
  targetMonth: string,
): ByIssue {
  const dates = datesInMonth(targetMonth);
  const dateSet = new Set(dates);
  const issueByKey = new Map(issues.map((issue) => [issueKey(issue.repository, issue.issueNumber), issue]));
  if (issueByKey.size !== issues.length) throw new Error("Duplicate Issue key");

  const direct = new Map<string, Map<string, number>>();
  for (const log of workLogs) {
    if (!dateSet.has(log.workDate)) continue;
    const key = issueKey(log.repository, log.issueNumber);
    if (!issueByKey.has(key)) throw new Error(`WorkLog Issue is missing: ${key}`);
    const days = direct.get(key) ?? new Map<string, number>();
    days.set(log.workDate, addHundredths(days.get(log.workDate) ?? 0, toHundredths(log.hours)));
    direct.set(key, days);
  }

  const children = new Map<string, IssueInfo[]>();
  const roots: IssueInfo[] = [];
  for (const issue of issues) {
    if (issue.parentIssueNumber === null) {
      roots.push(issue);
      continue;
    }
    const parentKey = issueKey(issue.repository, issue.parentIssueNumber);
    if (!issueByKey.has(parentKey)) throw new Error(`Parent Issue is missing: ${parentKey}`);
    const siblings = children.get(parentKey) ?? [];
    siblings.push(issue);
    children.set(parentKey, siblings);
  }

  const order = (a: IssueInfo, b: IssueInfo) =>
    a.repository.localeCompare(b.repository) || a.issueNumber - b.issueNumber;
  roots.sort(order);
  for (const siblings of children.values()) siblings.sort(order);

  const rows: IssueRow[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(issue: IssueInfo): Map<string, number> {
    const key = issueKey(issue.repository, issue.issueNumber);
    if (visiting.has(key)) throw new Error(`Circular Issue hierarchy: ${key}`);
    if (visited.has(key)) throw new Error(`Issue visited twice: ${key}`);
    visiting.add(key);

    // 行は親から出す。子孫の計算後にこの行の日別値と Total を確定する。
    const row: IssueRow = { issue, days: [], direct: 0, total: 0 };
    rows.push(row);
    const sums = new Map(direct.get(key));
    for (const child of children.get(key) ?? []) {
      for (const [date, hours] of visit(child)) {
        sums.set(date, addHundredths(sums.get(date) ?? 0, hours));
      }
    }
    row.days = dates.map((date) => {
      const amount = sums.get(date);
      return { date, hours: amount === undefined ? null : fromHundredths(amount) };
    });
    row.direct = fromHundredths([...(direct.get(key)?.values() ?? [])].reduce(addHundredths, 0));
    row.total = fromHundredths([...sums.values()].reduce(addHundredths, 0));
    visiting.delete(key);
    visited.add(key);
    return sums;
  }

  for (const root of roots) visit(root);
  if (visited.size !== issues.length) throw new Error("Circular Issue hierarchy");
  return { dates, rows };
}
