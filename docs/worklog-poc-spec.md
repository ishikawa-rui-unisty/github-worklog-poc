# GitHub Issues 工数管理 PoC 仕様書

## 1. 目的と原則

GitHub Issues / GitHub Projects をタスク管理の正本とし、Issue コメントの `/work` コマンドで工数を登録する。GitHub Actions が工数明細と集計結果を Google Sheets に同期する。

- 対象は **1 GitHub Project × 1 Repository** とする。
- GitHub が Source of Truth、Google Sheets は再生成可能な Projection とする。
- Sheet の破損・同期漏れ・手動編集の影響は、GitHub からの Rebuild で復旧できることを目標とする。
- Closed Issue の過去実績も保持・集計する。
- 親子関係と Project 所属について、過去時点の履歴は保持しない（「制約」を参照）。

## 2. 対象範囲

現在、指定した GitHub Project に所属する Issue を工数入力対象とする。対象 Issue は Open / Closed を問わない。

- Project 所属 Issue の `/work`: 受付・同期する。
- Project 外 Issue の新規 `/work`: 受付しない。既存の当該 `comment_id` の WorkLog があれば削除し、利用者へ対象外であることを通知する。
- Project から Issue を外しただけでは既存 WorkLog を削除しない。
- Project から外れた後に `/work` コメントを編集した場合、現在は対象外のため、そのコメント由来の WorkLog を削除し、新しい値は登録しない。
- Pull Request に対する `issue_comment` は対象外とする。

## 3. `/work` コマンド仕様

### 3.1 形式

```text
/work {hours}h [date]
```

例:

```text
/work 2.5h
/work 0h
/work 2h 09/17
/work 2h 2026-09-17
```

- `{hours}` は 0 以上の数値とし、整数・小数を許可する。`h` / `H` を許可する。小数第3位以降は四捨五入せず切り捨て、小数第2位までを登録する（例: `1.239h` → `1.23h`）。
- 実運用では利用者に `0.25h` 単位での入力を案内する。PoC の Parser はこの単位を強制しない。
- 日付は `MM/DD`、`MM-DD`、`YYYY/MM/DD`、`YYYY-MM-DD` を許可する。
- 内部の日付表現は常に `YYYY-MM-DD` とする。
- コマンド行の先頭の空白は許可する。
- `/work` は行頭のコマンドとしてのみ認識する。文中の `/work` は無視する。
- `/work2h` のように `/work` の直後が空白または行末でないものはコマンドではない。
- コマンド行の空白区切りは任意数許可するが、`/work {hours}h [date]` 以外の余分な引数はエラーとする。
- コードブロック・引用内かどうかは区別しない。行頭の `/work` は命令として扱う。

### 3.2 日付の決定

- 日付を省略した場合、コメントの `created_at` を `Asia/Tokyo` に変換した日付を使用する。
- `updated_at` は作業日の判定に使用しない。
- 年を省略した場合も、`created_at` を `Asia/Tokyo` に変換した年を使用する。前年・翌年を推測しない。
- 実在しない日付はエラーとする。例: `2026/02/29`、`2026/04/31`。

### 3.3 コメントと明細の関係

- **1 Comment = 1 WorkLog** とする。
- 1 コメント中に `/work` 行が 2 行以上ある場合はエラーとする。
- 同一ユーザー・同一 Issue・同一作業日に複数のコメントで工数を登録してよい。集計ではすべて合算する。
- 複数コメントの工数を、後から 1 コメントに合算して他のコメントから `/work` を消す、またはコメントを削除してよい。合計値が同じなら集計結果も同じである。

### 3.4 `0h` と未入力

`/work 0h` は有効な入力であり、WorkLog を作成する。

- `0`: 入力済み（0 時間）
- 空欄: WorkLog が存在せず未入力

この区別を ByUser の未入力判定で必ず維持する。

### 3.5 Parser の結果

コメント本文の解析結果は次の 3 状態とする。

- `none`: `/work` コマンドがない通常コメント。エラーではない。
- `valid`: 時間・作業日を確定できた。
- `invalid`: `/work` は存在するが形式不正。

不正理由は少なくとも次を区別する: `MULTIPLE_COMMANDS`、`MISSING_HOURS`、`INVALID_HOURS`、`INVALID_DATE`、`TOO_MANY_ARGUMENTS`。

## 4. 同期と冪等性

WorkLog の一意キーは GitHub Comment の `comment_id` とする。通常同期はイベント種別だけで INSERT / UPDATE を決めず、**現在のコメント状態**を正として `comment_id` の WorkLog を収束させる。

| 状態 | 既存 WorkLog あり | 既存 WorkLog なし |
| --- | --- | --- |
| `valid` | 更新 | 追加 |
| `none` | 削除 | 何もしない |
| `invalid` | 削除してエラー通知 | エラー通知 |
| コメント削除 | 削除 | 何もしない |

同じイベントを再実行しても二重登録せず、同じ結果になることを要件とする。入力エラーまたは対象外への変更で既存 WorkLog を削除する場合、Sheets への書込み成功後に GitHub へ通知する。

正常登録・更新時は対象コメントに成功リアクションを付ける。入力エラー時は、入力例を含む簡潔な Bot コメントを投稿する。リアクションの削除など細かな状態同期は PoC 対象外とする。

## 5. Issue と階層ロールアップ

Issue は `repository + issue_number` で識別する。Issue 情報は少なくとも、タイトル、状態、現在の `in_project`、親 Issue、階層レベル、URL を持つ。

Issues シートの対象は次の和集合とする。

```text
現在 Target Project に所属する Issue
+ 有効な過去 WorkLog を持つ Issue
+ 上記 Issue のすべての祖先 Issue
```

親が Project 外でも、階層を欠損させないため保持する。

ByIssue の日別ロールアップは次で計算する。

```text
Rollup(issue, date) = Direct(issue, date) + Σ Rollup(child, date)
```

- `Direct`: その Issue に直接入力された対象月の工数。
- `Total`: 子孫を含む対象月の工数。
- 親自身に直接登録された工数も必ず含める。
- 深さは固定せず、親子ツリーを DFS 順で表示する。

## 6. Google Sheets

1 つの Spreadsheet に以下の 6 シートを持つ。

| Sheet | 管理者 | 用途 |
| --- | --- | --- |
| WorkLogs | システム | 現在有効な工数明細（Raw） |
| Users | 手動 | 表示名・集計対象ユーザーの管理 |
| Issues | システム | Issue と現在の階層情報 |
| ByUser | システム | ユーザー別・日別 View |
| ByIssue | システム | Issue 別・日別・ロールアップ View |
| Settings | 手動 | 表示設定 |

Rebuild でも `Users` と `Settings` は上書きしない。システム管理シートは原則として手動編集禁止とし、可能なら保護範囲にする。

### 6.1 WorkLogs

1 行 = 1 WorkLog。列は次の順序を基本とする。

```text
comment_id, repository, issue_number, issue_title, github_user,
work_date, hours, created_at, updated_at, comment_url
```

### 6.2 Users

```text
github_user, display_name, aggregation_target
```

`aggregation_target = TRUE` のユーザーだけを ByUser の表示・未入力確認対象にする。

### 6.3 Settings

```text
target_month, timezone
```

例: `target_month = 2026/09`、`timezone = Asia/Tokyo`。対象月が空なら現在月を使う。Repository、Project Number、Spreadsheet ID などのシステム設定は GitHub Actions Variables で管理する。

### 6.4 ByUser

行は集計対象ユーザー、列は対象月の各日と `Total` とする。同一ユーザー・同一日の WorkLog をすべて合算し、Issue 階層は考慮しない。

未入力は以下をすべて満たす場合だけとする。

```text
aggregation_target = TRUE
かつ過去日
かつ月曜〜金曜
かつ WorkLog が 1 件もない
```

未入力セルは空欄かつ黄色で表示する。今日・未来・土日には警告しない。土日はグレー表示を許可する。祝日・休暇は PoC 対象外とする。

### 6.5 ByIssue

各 Issue を DFS 順に表示し、状態、日別 Rollup、`Direct`、`Total` を出力する。Closed / Project 外でも、対象 Issue 集合に該当する過去実績は表示する。

## 7. Sync と Rebuild

### 通常 Sync

`issue_comment` の `created`、`edited`、`deleted` を契機に実行する。WorkLog が変更されたら、更新後の WorkLogs から Issues、ByUser、ByIssue を再生成する。PoC では差分集計を行わない。

### Rebuild

手動起動 (`workflow_dispatch`) で、GitHub に残る全有効 `/work` コメントから WorkLogs / Issues / ByUser / ByIssue を再構築する。将来は夜間定期実行を検討する。

Rebuild は現在 Project 外の Issue にある有効な `/work` も復元する。これは GitHub の工数情報を失わないための意図的な仕様である。

## 8. 制約と PoC 対象外

親子関係の履歴は保持しない。ByIssue は常に**現在の GitHub 階層**で、全期間の過去工数も再計算する。そのため親子関係を変更すると、過去工数のロールアップ先も変わる。

Project 所属履歴も保持しない。通常 Sync では現在の所属状態で入力可否を決める一方、Rebuild は GitHub に残る有効な `/work` を復元する。このため「入力時点で Project に所属していたか」の監査はできない。

以下は PoC 対象外とする。

- 複数 Project / 複数 Repository の運用
- 祝日・休暇管理
- 1 日の合計時間などの業務妥当性チェック
- 組織メンバーの自動同期
- 高度な検索・ソート・ツリー UI
- 大規模データ向けの差分集計・性能最適化
- 本番レベルの監視・通知

## 9. PoC 合格条件

以下を満たすこと。

1. 4 種類の日付形式、JST の日付省略、`0h` を正しく解析できる。
2. 不正形式・複数 `/work`・実在しない日付を検出できる。
3. コメントの作成・編集・削除・再実行で `comment_id` 単位の冪等同期ができる。
4. 同じ人・同じ日・同じ Issue の複数明細を合算できる。
5. 0h と未入力を区別し、過去平日の未入力を可視化できる。
6. Issue 階層を再帰的にロールアップし、Closed / Project 外の過去実績を保持できる。
7. GitHub の情報から、手動管理の Users / Settings を保持したまま Sheets を再構築できる。
