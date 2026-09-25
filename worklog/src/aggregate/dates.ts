/** YYYY/MM と YYYY-MM を受け取り、対象月の全日付を返す。 */
export function datesInMonth(targetMonth: string): string[] {
  const match = /^(\d{4})[\/-](0[1-9]|1[0-2])$/.exec(targetMonth);
  if (!match) throw new Error(`Invalid target month: ${targetMonth}`);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from(
    { length: count },
    (_, index) => `${match[1]}-${match[2]}-${String(index + 1).padStart(2, "0")}`,
  );
}

/** UTC の瞬間を指定タイムゾーン上の暦日に変換する。 */
export function localDate(instant: Date, timezone: string): string {
  if (Number.isNaN(instant.getTime())) throw new Error("Invalid current time");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((value) => value.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** YYYY-MM-DD はゼロ埋め済みなので文字列順で日付順になる。 */
export function isWeekend(date: string): boolean {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}
