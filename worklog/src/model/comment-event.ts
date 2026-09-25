export type CommentEvent = {
  action: "created" | "edited" | "deleted";
  repository: string;
  issueNumber: number;
  commentId: number;
  commentBody: string | null;
  githubUser: string;
  createdAt: string;
  updatedAt: string;
  commentUrl: string;
  isPullRequest: boolean; // issue_comment は PR コメントでも発火する
};
