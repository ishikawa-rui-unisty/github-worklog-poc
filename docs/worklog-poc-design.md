# GitHub Issues 工数管理 PoC 実装設計書

## 1. 方針

GitHub Actions はトリガー・権限・実行環境だけを持ち、業務ロジックは TypeScript に置く。Parser、同期判定、集計は外部 API に依存しない純粋関数を中心にして Unit Test する。

```text
GitHub Issue Comment / workflow_dispatch
  -> GitHub Actions
  -> TypeScript entry point
     -> Parser / sync / aggregation
     -> GitHub client + Sheets client
  -> Google Sheets
```

## 2. 推奨ディレクトリ構成

既存リポジトリの TypeScript、テスト、formatter、linter の構成を最優先する。新規構成が必要な場合の目安は次のとおり。

```text
.github/workflows/
  worklog-sync.yml
  worklog-rebuild.yml
worklog/
  src/
    sync.ts
    rebuild.ts
    config.ts
    model/
      work-log.ts
      issue.ts
      user.ts
      comment-event.ts
    parser/work-command-parser.ts
    sync/work-log-sync.ts
    aggregate/by-user.ts
    aggregate/by-issue.ts
    github/github-client.ts
    sheets/sheets-client.ts
  test/
    work-command-parser.test.ts
    work-log-sync.test.ts
    by-user.test.ts
    by-issue.test.ts
```

## 3. ドメインモデル

```ts
type WorkLog = {
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

type IssueInfo = {
  repository: string;
  issueNumber: number;
  title: string;
  parentIssueNumber: number | null;
  level: number;
  state: "open" | "closed";
  inProject: boolean;
  issueUrl: string;
};

type User = {
  githubUser: string;
  displayName: string;
  aggregationTarget: boolean;
};

type CommentEvent = {
  action: "created" | "edited" | "deleted";
  repository: string;
  issueNumber: number;
  commentId: number;
  commentBody: string | null;
  githubUser: string;
  createdAt: string;
  updatedAt: string;
  commentUrl: string;
  isPullRequest: boolean;
};
```

Issue Key は将来の複数 Repository 対応を見越して `repository + issueNumber` とする。WorkLog の主キーは `commentId` である。

## 4. Parser 設計

公開関数は純粋関数とする。

```ts
parseWorkCommand(
  body: string,
  createdAt: string,
  timezone: string,
): ParseResult
```

```ts
type ParseResult =
  | { status: "none" }
  | {
      status: "valid";
      hours: number;
      workDate: string;
      dateSpecified: boolean;
    }
  | { status: "invalid"; errorCode: WorkCommandError };
```

実装は正規表現一発ではなく、以下の段階で行う。

1. 本文を行へ分割し、先頭空白を除いた後に `/work` と空白または行末が続く行を抽出する。
2. 0 行なら `none`、2 行以上なら `MULTIPLE_COMMANDS`。
3. 1 行を空白でトークン化し、引数数を検証する。
4. hours を 0 以上の数値として検証し、文字列上で小数第3位以降を切り捨てて百分の1時間へ変換する。
5. 日付を解析し、年省略時は `createdAt` の指定タイムゾーン上の年を補う。
6. 実在日を検証して `YYYY-MM-DD` へ正規化する。

Parser は Issue、Project、GitHub API、Sheets API、Bot の表示文言を参照しない。エラーコードから利用者向けメッセージへ変換するのは呼び出し側の責務とする。

## 5. Sync 処理

`sync.ts` は GitHub Actions のイベントを `CommentEvent` へ変換し、以下を実行する。

```text
PR コメントなら終了
  -> deleted: comment_id で WorkLog を削除
  -> created / edited:
       Parser
       -> none / invalid: 既存 WorkLog を削除（invalid は後で通知）
       -> valid: 現在の Target Project 所属を確認
           -> 対象外: 既存 WorkLog を削除して通知
           -> 対象: comment_id で WorkLog を upsert
  -> 更新後 WorkLogs を基に Issues / ByUser / ByIssue を全てメモリ上で作成
  -> Sheets へ書込
  -> 成功後に GitHub へリアクションまたはエラー通知
```

`sync/work-log-sync.ts` は Sheets を知らない純粋関数として、現在の `WorkLog[]` と `commentId`、解析結果・イベント情報から次の `WorkLog[]` を返す。これにより再実行時も冪等になる。

WorkLogs は「全件読込 -> `Map<commentId, WorkLog>` 化 -> 更新 -> 全件書戻し」とする。PoC では数百〜数千件程度を想定し、行番号を主キーにしない。

## 6. Rebuild 処理

`rebuild.ts` は対象 Repository の Issue コメントをページングして取得し、PR コメントを除外して Parser に通す。`valid` なものから WorkLogs を再生成する。

1. 現在の Target Project Issue を取得する。
2. Repository の有効 `/work` コメントを走査して WorkLogs と `historicalWorkIssues` を作る。
3. `currentProjectIssues ∪ historicalWorkIssues` に全祖先を加えて IssueInfo を取得する。
4. Users / Settings を読み、WorkLogs / Issues / ByUser / ByIssue を生成する。
5. システム管理 4 シートだけを全置換する。

Rebuild では現在 Project 外の有効 `/work` も復元する。これは所属履歴を持たない PoC の明示的なトレードオフである。

## 7. GitHub Client

`github-client.ts` が GitHub REST / GraphQL の詳細、ページング、認証を隠蔽する。少なくとも次の操作を提供する。

```ts
isIssueInTargetProject(repository, issueNumber): Promise<boolean>
getTargetProjectIssues(): Promise<IssueInfo[]>
getIssue(repository, issueNumber): Promise<IssueInfo>
getParentIssue(repository, issueNumber): Promise<IssueInfo | null>
listIssueComments(repository): AsyncIterable<CommentEvent>
addSuccessReaction(comment): Promise<void>
postValidationError(issue, comment, error): Promise<void>
```

Issue の祖先は再帰的に解決する。取得済み Issue は `Map<IssueKey, IssueInfo>` にキャッシュし、経路中の `visited` Set で循環を検出して `CIRCULAR_ISSUE_HIERARCHY` として失敗させる。親が Project 外でも取得・出力する。`level` は親が揃った後に計算する。

## 8. 集計

工数は小数第2位までを登録し、集計中は百分の1時間の整数で加算する。出力時だけ時間単位の数値へ戻し、小数の浮動小数点加算誤差を避ける。

### ByUser

`aggregateByUser(workLogs, users, targetMonth, timezone)` は `githubUser + workDate` で `hours` を合計し、`aggregationTarget` の Users だけを行として出力する。セルには「WorkLog が存在しない」場合だけ空欄を置くため、0h は数値 `0` として残る。日付・黄色未入力・土日グレーなどの書式指定もこの層の出力モデルに含めるか、Sheets 側の明確な変換層に置く。

### ByIssue

`aggregateByIssue(workLogs, issues, targetMonth)` はまず Issue ごとの直接工数を日付 Map へ集計し、子 Issue 一覧を作って再帰的にロールアップする。各 Issue の `Direct` と子孫込みの `Total`、各日付の Rollup を返す。表示行はルートから DFS 順とする。

集計は必ず Sheets から再読込せず、更新後 WorkLogs のメモリ上の値だけから生成する。

## 9. Sheets Client

`sheets-client.ts` は次を担当する。

- WorkLogs、Users、Issues、Settings の読み込みと型変換。
- WorkLogs / Issues / ByUser / ByIssue の値・必要書式の書込み。
- 書込み前の対象範囲クリアとヘッダを含む全置換。
- Users / Settings を Rebuild 時にも変更しない保証。

値は可能な限りまとめて書き込み、途中計算の保存場所として Sheets を使わない。システム管理シートの保護は Spreadsheet 設定として行う。

## 10. Config と認証

`config.ts` は起動時に環境変数を検証し、型付き設定を返す。例:

```text
GITHUB_OWNER
GITHUB_REPOSITORY
GITHUB_PROJECT_NUMBER
GOOGLE_SHEETS_SPREADSHEET_ID
WORKLOG_TIMEZONE=Asia/Tokyo
GOOGLE_WORKLOAD_IDENTITY_PROVIDER
GOOGLE_SERVICE_ACCOUNT
```

Repository / Project Number / Spreadsheet ID は GitHub Actions Variables、機密値は GitHub Secrets または OIDC 構成側で管理する。

GitHub API 認証は、まず workflow 標準の `GITHUB_TOKEN` で対象 Project の読取可否を確認する。権限不足なら GitHub App の短期 Installation Token を優先する。PoC で PAT を使用する場合は暫定措置とし、本番化前に GitHub App 等への置き換えを検討する。`WORKLOG_GITHUB_TOKEN` はトークンの種類を固定しない入力名であり、PAT の使用を意味しない。

Google Sheets 認証の本命は次である。

```text
GitHub Actions OIDC
  -> Google Cloud Workload Identity Federation
  -> Google Service Account
  -> Google Sheets API
```

長期の Service Account キーを GitHub Secrets に置かない。PoC 環境準備の都合で一時的なキー方式を使う場合も、WIF 移行を前提に認証処理を分離する。

## 11. Workflows と排他制御

`worklog-sync.yml` は `issue_comment` の `created`、`edited`、`deleted` で起動する。`worklog-rebuild.yml` は `workflow_dispatch` で起動する。両 workflow は同じ concurrency group を用いる。

```yaml
concurrency:
  group: worklog-sheet-sync
  cancel-in-progress: false
```

WorkLogs を全件読み書きするため、Sync 同士だけでなく Sync と Rebuild も同時に実行してはならない。待機中の実行をキャンセルしないことを確認する。Workflow YAML に業務ロジックは書かない。

## 12. テスト方針

外部 API を使わない層を Unit Test の中心に置く。

| 対象 | 主なケース |
| --- | --- |
| Parser | 日付 4 形式、JST 日付境界、年省略、0h、空白、`H`、通常コメント、余分な引数、負数、不正日、複数コマンド |
| WorkLog 同期 | insert / update / delete / no-op、created・edited の再実行、invalid・none への編集、コメント削除 |
| ByUser | 同日複数明細の合算、0 と空欄、未入力条件、対象外ユーザー |
| ByIssue | direct、複数階層の rollup、親の直接工数、DFS 順、Closed / Project 外の過去 Issue |
| Issue 階層 | 祖先補完、キャッシュ、循環検出 |

GitHub / Sheets Client は薄い adapter に保ち、必要に応じてモックを使った結合テストを追加する。Rebuild と実際の OIDC/WIF はテスト用 Project / Spreadsheet で手動の疎通確認を行う。

## 13. 実装 Phase

| Phase | 範囲 |
| --- | --- |
| 1 | 既存構成の確認、TypeScript 雛形、package / tsconfig / test 基盤、Config・Domain Model |
| 2 | `/work` Parser と Parser Unit Test |
| 3 | WorkLog 同期の純粋関数、ByUser / ByIssue 集計、Unit Test |
| 4 | GitHub Client、Sheets Client、通常 Sync workflow、concurrency、成功・エラー通知、WIF / OIDC の認証経路 |
| 5 | Rebuild workflow、実環境での WIF / OIDC 疎通・回復テスト |

Phase 1〜2 では GitHub API、Google Sheets API、GitHub Actions Workflow、集計、Rebuild を実装しない。
