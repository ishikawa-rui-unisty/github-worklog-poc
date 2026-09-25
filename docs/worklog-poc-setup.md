# Worklog Sync 環境設定

Phase 4 の通常同期を実行する前に、次を設定する。外部サービスへの疎通確認は Phase 5 で行う。

## GitHub

- Repository Variables: `GITHUB_PROJECT_NUMBER`, `GITHUB_PROJECT_OWNER`, `GITHUB_PROJECT_OWNER_TYPE` (`user` または `organization`), `GOOGLE_SHEETS_SPREADSHEET_ID`, `GOOGLE_WORKLOAD_IDENTITY_PROVIDER`, `GOOGLE_SERVICE_ACCOUNT`。
- まず workflow 標準の `GITHUB_TOKEN` で対象 Project を読めるか確認する。権限不足なら、Project 読取権限と対象 Repository の Issue 書込権限を持つ GitHub App の短期 Installation Token を優先する。
- PoC の暫定策として PAT を使う場合のみ、Repository Secret `WORKLOG_GITHUB_TOKEN` に保存する。長期 PAT を使った場合は本番化前に GitHub App 等へ置き換える。Secret が未設定なら workflow は `GITHUB_TOKEN` を使用する。
- GitHub App を採用する場合、短期 Installation Token を workflow 内で発行して同期処理へ渡す設定が必要。現在の workflow には App トークン発行ステップは未実装。
- 対象 Repository は実行中の `GITHUB_REPOSITORY` から取得する。

## Google Cloud / Sheets

- Google Sheets API を有効化し、Service Account に対象 Spreadsheet の編集権限を与える。
- GitHub Actions OIDC から Google Cloud Workload Identity Federation を経由して Service Account を利用する。Provider は対象 Repository からの認証に制限する。
- Workflow は短時間有効な Sheets scope のアクセストークンを取得する。長期の Service Account キーは保存しない。
- 初回実行時に `WorkLogs`, `Users`, `Issues`, `ByUser`, `ByIssue`, `Settings` の 6 シートを作る。`Users` と `Settings` が既にあれば上書きしない。
- `Users` は `github_user`, `display_name`, `aggregation_target` を手動で管理する。`Settings` の `target_month` (例: `2026/09`) と `timezone` (例: `Asia/Tokyo`) は key/value 行で管理する。

## 運用上の注意

- Project から外した Issue の既存 WorkLog は維持する。ただし、その `/work` コメントを後で編集すると通常 Sync は現在の Project 所属に基づいて明細を削除する。
- GitHub Actions の同一 concurrency group で WorkLogs 全件の読み書きを直列化する。将来の Rebuild workflow も `worklog-sheet-sync` を使う。
- Sheets 書込みは複数 API 呼出しからなる。途中で失敗した場合は workflow を再実行するか Rebuild で回復する。
