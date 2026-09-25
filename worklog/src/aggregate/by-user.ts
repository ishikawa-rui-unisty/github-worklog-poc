import type { User } from "../model/user.js";
import type { WorkLog } from "../model/work-log.js";
import { addHundredths, fromHundredths, toHundredths } from "../model/hours.js";
import { datesInMonth, isWeekend, localDate } from "./dates.js";

export type UserDay = {
  date: string;
  hours: number | null;
  missing: boolean;
  weekend: boolean;
};

export type UserRow = {
  githubUser: string;
  displayName: string;
  days: UserDay[];
  total: number;
};

export type ByUser = { dates: string[]; rows: UserRow[] };

/** WorkLog の存在を保持し、0h と未入力を区別して集計する。 */
export function aggregateByUser(
  workLogs: readonly WorkLog[],
  users: readonly User[],
  targetMonth: string,
  timezone: string,
  now: Date = new Date(),
): ByUser {
  const dates = datesInMonth(targetMonth);
  const today = localDate(now, timezone);
  const byUser = new Map<string, Map<string, number>>();

  for (const log of workLogs) {
    const days = byUser.get(log.githubUser) ?? new Map<string, number>();
    days.set(log.workDate, addHundredths(days.get(log.workDate) ?? 0, toHundredths(log.hours)));
    byUser.set(log.githubUser, days);
  }

  const rows = users.filter((user) => user.aggregationTarget).map((user) => {
    const loggedDays = byUser.get(user.githubUser);
    const days = dates.map((date): UserDay => {
      const weekend = isWeekend(date);
      const amount = loggedDays?.get(date);
      const hours = amount === undefined ? null : fromHundredths(amount);
      return {
        date,
        hours,
        weekend,
        missing: hours === null && date < today && !weekend,
      };
    });
    return {
      githubUser: user.githubUser,
      displayName: user.displayName,
      days,
      total: fromHundredths(dates.reduce((sum, date) =>
        addHundredths(sum, loggedDays?.get(date) ?? 0), 0)),
    };
  });

  return { dates, rows };
}
