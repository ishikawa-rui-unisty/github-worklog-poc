export type WorkLog = {
  // 1 コメント = 1 明細。同期・再実行時の一意キーにする。
  commentId: number;
  repository: string;
  issueNumber: number;
  issueTitle: string;
  githubUser: string;
  workDate: string; // YYYY-MM-DD
  hours: number;
  createdAt: string;
  updatedAt: string;
  commentUrl: string;
};
