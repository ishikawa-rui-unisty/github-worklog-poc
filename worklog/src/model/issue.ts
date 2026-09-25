export type IssueInfo = {
  // Issue 番号は Repository 内でのみ一意。両方を組にして識別する。
  repository: string;
  issueNumber: number;
  title: string;
  // 履歴は持たず、GitHub の現在の親子関係を表す。
  parentIssueNumber: number | null;
  level: number;
  state: "open" | "closed";
  inProject: boolean; // 現在の Project 所属状態
  issueUrl: string;
};
