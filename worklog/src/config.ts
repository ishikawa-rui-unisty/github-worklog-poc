export type WorklogConfig = {
  timezone: string;
};

export const DEFAULT_TIMEZONE = "Asia/Tokyo";

export function getWorklogConfig(
  environment: NodeJS.ProcessEnv = process.env,
): WorklogConfig {
  const timezone = environment.WORKLOG_TIMEZONE ?? DEFAULT_TIMEZONE;
  // 無効な値を起動時に検出し、工数日の誤判定を防ぐ。
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    throw new Error(`Invalid WORKLOG_TIMEZONE: ${timezone}`);
  }
  return {
    timezone,
  };
}
