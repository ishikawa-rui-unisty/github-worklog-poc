/** /work の時間を小数第2位で切り捨て、百分の1時間の整数へ変換する。 */
export function parseHoursToHundredths(token: string): number | null {
  const match = /^(\d+)(?:\.(\d+))?[hH]$/.exec(token);
  if (!match) return null;

  const hundredths = BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0").slice(0, 2));
  if (hundredths > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(hundredths);
}

/** WorkLogs の hours は Parser で小数第2位までに正規化済みであることを確認する。 */
export function toHundredths(hours: number): number {
  const value = Math.round(hours * 100);
  if (!Number.isFinite(hours) || hours < 0 || !Number.isSafeInteger(value) ||
      Math.abs(value / 100 - hours) > 1e-9) {
    throw new Error(`Invalid WorkLog hours: ${hours}`);
  }
  return value;
}

export function addHundredths(left: number, right: number): number {
  const sum = left + right;
  if (!Number.isSafeInteger(sum)) throw new Error("WorkLog hours total exceeds safe range");
  return sum;
}

export function fromHundredths(value: number): number {
  return value / 100;
}
