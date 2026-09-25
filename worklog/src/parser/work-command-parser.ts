export type WorkCommandError =
  | "MULTIPLE_COMMANDS"
  | "MISSING_HOURS"
  | "INVALID_HOURS"
  | "INVALID_DATE"
  | "TOO_MANY_ARGUMENTS";

export type ParseResult =
  // none は通常コメント。invalid と区別し、呼び出し側で不要なエラー通知を避ける。
  | { status: "none" }
  | {
      status: "valid";
      hours: number;
      workDate: string;
      dateSpecified: boolean;
    }
  | { status: "invalid"; errorCode: WorkCommandError };

// 行頭の /work だけを認識する。/work2h などはコマンドと見なさない。
const WORK_COMMAND = /^\/work(?:\s|$)/;
const HOURS = /^(?:0|[0-9]+(?:\.[0-9]+)?)[hH]$/;
const MONTH_DAY = /^(\d{2})[\/-](\d{2})$/;
// 区切り文字を後方参照し、2026/09-17 のような混在を拒否する。
const FULL_DATE = /^(\d{4})([\/-])(\d{2})\2(\d{2})$/;

/** コメント本文と投稿日から工数を解析する。外部 API には依存しない。 */
export function parseWorkCommand(
  body: string,
  createdAt: string,
  timezone: string,
): ParseResult {
  // コメント内の説明文は許可するが、/work 行は 1 行だけに制限する。
  const commands = body
    .split(/\r?\n/)
    .filter((line) => WORK_COMMAND.test(line.trimStart()));

  if (commands.length === 0) return { status: "none" };
  if (commands.length > 1) {
    return { status: "invalid", errorCode: "MULTIPLE_COMMANDS" };
  }

  const tokens = commands[0].trim().split(/\s+/);
  if (tokens.length === 1) {
    return { status: "invalid", errorCode: "MISSING_HOURS" };
  }
  if (tokens.length > 3) {
    return { status: "invalid", errorCode: "TOO_MANY_ARGUMENTS" };
  }

  const hoursToken = tokens[1];
  if (!HOURS.test(hoursToken)) {
    return { status: "invalid", errorCode: "INVALID_HOURS" };
  }

  const hours = Number(hoursToken.slice(0, -1));
  if (!Number.isFinite(hours)) {
    return { status: "invalid", errorCode: "INVALID_HOURS" };
  }

  // 日付省略時も編集日時ではなく、元の投稿日を基準にする。
  const dateSpecified = tokens.length === 3;
  const workDate = dateSpecified
    ? parseExplicitDate(tokens[2], createdAt, timezone)
    : dateFromCreatedAt(createdAt, timezone);

  if (workDate === null) {
    return { status: "invalid", errorCode: "INVALID_DATE" };
  }

  return { status: "valid", hours, workDate, dateSpecified };
}

function parseExplicitDate(
  token: string,
  createdAt: string,
  timezone: string,
): string | null {
  const fullMatch = FULL_DATE.exec(token);
  if (fullMatch) {
    return normalizeDate(Number(fullMatch[1]), Number(fullMatch[3]), Number(fullMatch[4]));
  }

  const monthDayMatch = MONTH_DAY.exec(token);
  if (!monthDayMatch) return null;

  const createdDate = dateFromCreatedAt(createdAt, timezone);
  if (createdDate === null) return null;
  // 年をまたぐ推測はせず、投稿日を指定タイムゾーンへ変換した年を使う。
  const year = Number(createdDate.slice(0, 4));
  return normalizeDate(year, Number(monthDayMatch[1]), Number(monthDayMatch[2]));
}

function dateFromCreatedAt(createdAt: string, timezone: string): string | null {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return null;

  try {
    // UTC の日付境界と異なる場合があるため、指定タイムゾーンの暦日を取り出す。
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((value) => value.type === type)?.value;
    const year = part("year");
    const month = part("month");
    const day = part("day");
    return year && month && day ? `${year}-${month}-${day}` : null;
  } catch {
    return null;
  }
}

function normalizeDate(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  // Date は 2/30 などを翌月へ繰り上げるため、生成後に各要素を照合する。
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
