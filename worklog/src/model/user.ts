export type User = {
  githubUser: string;
  displayName: string;
  aggregationTarget: boolean; // ByUser 表示と未入力判定の対象か
};
