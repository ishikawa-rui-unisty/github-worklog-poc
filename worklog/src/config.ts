export type WorklogConfig = {
  timezone: string;
};

export type RuntimeConfig = WorklogConfig & {
  repository: string;
  projectOwner: string;
  projectOwnerType: "organization" | "user";
  projectNumber: number;
  spreadsheetId: string;
  githubToken: string;
  googleAccessToken: string;
  eventPath: string;
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

/** 外部連携に必要な値は、同期の開始前にまとめて検証する。 */
export function getRuntimeConfig(environment: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const required = (name: string): string => {
    const value = environment[name]?.trim();
    if (!value) throw new Error(`Missing ${name}`);
    return value;
  };
  const repository = required("GITHUB_REPOSITORY");
  if (!/^[^/]+\/[^/]+$/.test(repository)) throw new Error("Invalid GITHUB_REPOSITORY");
  const projectNumber = Number(required("GITHUB_PROJECT_NUMBER"));
  if (!Number.isSafeInteger(projectNumber) || projectNumber <= 0) {
    throw new Error("Invalid GITHUB_PROJECT_NUMBER");
  }
  const ownerType = environment.GITHUB_PROJECT_OWNER_TYPE?.trim() || "user";
  if (ownerType !== "organization" && ownerType !== "user") {
    throw new Error("GITHUB_PROJECT_OWNER_TYPE must be organization or user");
  }
  return {
    ...getWorklogConfig(environment),
    repository,
    projectOwner: environment.GITHUB_PROJECT_OWNER?.trim() || repository.split("/")[0],
    projectOwnerType: ownerType,
    projectNumber,
    spreadsheetId: required("GOOGLE_SHEETS_SPREADSHEET_ID"),
    githubToken: required("WORKLOG_GITHUB_TOKEN"),
    googleAccessToken: required("GOOGLE_ACCESS_TOKEN"),
    eventPath: required("GITHUB_EVENT_PATH"),
  };
}
