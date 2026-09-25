import type { IssueInfo } from "../model/issue.js";

type RestIssue = {
  number: number;
  title: string;
  state: "open" | "closed";
  html_url: string;
  repository_url?: string;
  pull_request?: unknown;
};

export type GithubComment = {
  id: number;
  body: string | null;
  user: { login: string } | null;
  created_at: string;
  updated_at: string;
  html_url: string;
};

type ProjectItem = { content: null | { number?: number; repository?: { nameWithOwner: string } } };
type ProjectPage = {
  nodes: ProjectItem[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
};

export class GithubClient {
  constructor(
    private readonly token: string,
    private readonly projectOwner: string,
    private readonly projectNumber: number,
    private readonly projectOwnerType: "organization" | "user",
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private async rest<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.fetcher(`https://api.github.com${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error(`GitHub ${method} ${path}: ${response.status} ${await response.text()}`);
    return response.json() as Promise<T>;
  }

  private async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const response = await this.fetcher("https://api.github.com/graphql", {
      method: "POST",
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    if (!response.ok) throw new Error(`GitHub GraphQL: ${response.status} ${await response.text()}`);
    const result = await response.json() as { data?: T; errors?: { message: string }[] };
    if (result.errors?.length) throw new Error(`GitHub GraphQL: ${result.errors.map((error) => error.message).join("; ")}`);
    if (!result.data) throw new Error("GitHub GraphQL returned no data");
    return result.data;
  }

  /** Project の全ページを読み、指定 Repository の Issue だけを返す。 */
  async getTargetProjectIssueNumbers(repository: string): Promise<Set<number>> {
    const query = `query($owner: String!, $number: Int!, $cursor: String) {
      ${this.projectOwnerType}(login: $owner) { projectV2(number: $number) { items(first: 100, after: $cursor) {
        nodes { content { ... on Issue { number repository { nameWithOwner } } } }
        pageInfo { hasNextPage endCursor } } } }
    }`;
    const numbers = new Set<number>();
    let cursor: string | null = null;
    do {
      const data: {
        organization?: { projectV2: { items: ProjectPage } | null } | null;
        user?: { projectV2: { items: ProjectPage } | null } | null;
      } = await this.graphql(query, { owner: this.projectOwner, number: this.projectNumber, cursor });
      const page: ProjectPage | undefined = data[this.projectOwnerType]?.projectV2?.items;
      if (!page) throw new Error("Target GitHub Project is unavailable; check owner, number, and token permissions");
      for (const item of page.nodes) {
        if (item.content?.repository?.nameWithOwner === repository && item.content.number !== undefined) {
          numbers.add(item.content.number);
        }
      }
      if (page.pageInfo.hasNextPage && !page.pageInfo.endCursor) throw new Error("Project pagination cursor is missing");
      cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    } while (cursor !== null);
    return numbers;
  }

  async getComment(repository: string, commentId: number): Promise<GithubComment | null> {
    const response = await this.fetcher(`https://api.github.com/repos/${repository}/issues/comments/${commentId}`, {
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${this.token}`,
        "X-GitHub-Api-Version": "2022-11-28" },
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub comment ${commentId}: ${response.status} ${await response.text()}`);
    return response.json() as Promise<GithubComment>;
  }

  async getIssue(repository: string, issueNumber: number): Promise<RestIssue> {
    const issue = await this.rest<RestIssue>("GET", `/repos/${repository}/issues/${issueNumber}`);
    if (issue.pull_request) throw new Error(`Issue #${issueNumber} is a pull request`);
    return issue;
  }

  async getParentIssue(repository: string, issueNumber: number): Promise<number | null> {
    const response = await this.fetcher(`https://api.github.com/repos/${repository}/issues/${issueNumber}/parent`, {
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${this.token}`,
        "X-GitHub-Api-Version": "2022-11-28" },
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub parent Issue #${issueNumber}: ${response.status} ${await response.text()}`);
    const issue = await response.json() as RestIssue;
    if (issue.repository_url && !issue.repository_url.endsWith(`/repos/${repository}`)) {
      throw new Error(`Cross-repository parent Issue is outside the PoC scope: #${issueNumber}`);
    }
    return issue.number;
  }

  async getIssueInfo(repository: string, issueNumber: number, inProject: boolean): Promise<IssueInfo> {
    const [issue, parentIssueNumber] = await Promise.all([
      this.getIssue(repository, issueNumber), this.getParentIssue(repository, issueNumber),
    ]);
    return { repository, issueNumber, title: issue.title, state: issue.state,
      parentIssueNumber, level: 0, inProject, issueUrl: issue.html_url };
  }

  async addSuccessReaction(repository: string, commentId: number): Promise<void> {
    await this.rest("POST", `/repos/${repository}/issues/comments/${commentId}/reactions`, { content: "+1" });
  }

  async postValidationError(repository: string, issueNumber: number, message: string): Promise<void> {
    await this.rest("POST", `/repos/${repository}/issues/${issueNumber}/comments`, { body: message });
  }
}
