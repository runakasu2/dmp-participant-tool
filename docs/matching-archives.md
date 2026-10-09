# 対戦表の保存・過去ラウンド参照

## 利用方法

1. デッキメモに対戦サイトURLとDMP大会URLを入力し、「大会情報・最新対戦表を取得」を押す。
2. 大会名・開催日・大会URLのShopID / EventID / Seqを確認して「全ラウンドの対戦表を保存・更新」を押す。
3. 「表示ラウンド」で取得済みの各回戦に切り替える。デッキの変更は従来のデッキメモAPIで保存され、同じ大会・DMP IDの全回戦に反映される。
4. サイト消去後は「保存済み対戦表」から大会を開く。再読み込み後も保存済みデータを参照でき、元サイトの取得は不要。
5. 「対戦表削除」は確認後に対戦表だけを削除する。デッキメモ、プレイヤー、大会結果、デッキ履歴は変更しない。

保存時も取得し直すため、最新の勝敗を反映できる。保存後に全ラウンドを自動で再表示し、選択中の回戦があれば維持する。のじぎく・TCGマイスター・スガツールの公開中データが対象で、自動巡回・定刻保存は実装していない。消去前に操作する必要がある。

## 保存形式・識別

既存の `migrations/013_matching_archives.sql` を再利用する。今回の拡張にSQL変更・追加マイグレーションはない。

- `matching_archives`: `event_record_id`（既存eventsのShopID + EventID + Seq）、提供元、外部大会キー、URL、保存日時。大会・提供元・外部キーの組合せが一意。
- `matching_archive_matches`: 大会アーカイブID、回戦、試合キー、卓、両選手のJSON、勝敗、勝者キー、未判定理由、元のwinnerと内部番号。大会・回戦・試合キーが一意。

のじぎくの外部キーはadmin。admin単独では大会を特定せず、既存のデッキメモに紐付いたDMP大会の3項目を保存時に検証する。提供元が同じadminを再使用した場合も、異なるSeqのデータ・デッキは分離される。ただしURLが実際にどの大会を指すかは利用者が大会情報と照合する必要がある。

選手キーはDMP IDを優先。DMP IDがなければ大会内の提供元内部番号、番号もなければ回戦・卓・側から作る未照合キーを保存する。名前だけでは統合しない。DMP ID未取得でも確認できた大会内識別子があれば既存deck_memo_external_playersでデッキを編集できる。識別不能な席・参加者情報の欠落は参照のみ。内部番号をDMP IDとして送らない。

`winner` が双方の異なる内部番号のどちらかに一致した場合のみ勝敗を確定。負数・未知の番号・曖昧な番号は元値と理由を保持し未判定とする。明示的なByeは専用状態、相手欠落は未判定。Byeに勝者や点数を捏造しない。

保存テーブルと4本の保存・一覧・詳細・削除APIを3サイトで共用する。今回の拡張に追加APIパス・追加マイグレーションはなく、013と既存のメモテーブルを再利用する。最新ラウンド取得を維持し、保存後は保存済み詳細を開いて全回戦を表示する。

### TCGマイスター

`tcg-results.js`の匿名セッション、Cookie、文字コード、ページネーション、得点差復元を使用する。`tour.asp`の予選リンク（znt=0または既存形式の省略リンク）から公開回戦を発見し、znt=2の決勝リンクは取得しない。1〜32回戦、各回戦最大50ページ・合計250ページ・既存60秒期限／4MiBページ制限を維持。

公開リンクの最大回戦を「予選最終回戦」とは推測しない。総回戦数未確認時、最後の公開回戦は次回戦得点がないため未判定。TCG大会条件欄で当該大会の総回戦数を確認・指定すると成績表との差分を利用できる。開始0点と0/0＝両者敗北もそれぞれ確認・指定した場合のみ適用し、保存前に大会キー・tid・選択条件を確認する。初期値は全項目未確認。指定条件と得点の出典は各試合のraw_resultに保持する。

内部番号は既存メモの`id:{番号}`に変換し、大会・tidを別管理して大会間で混同しない。raw No.で識別できる場合は最新取得と同じハッシュキーを使う。名前だけでは照合しない。確認済み両者敗北はdouble_loss（勝者なし）、Byeはbye、曖昧な得点・欠落・不整合はunresolved。

### スガツール

公開API `GET /events/{UUID}` のcurrentRoundから1〜currentRoundを取得する。maxRoundsを理由に未公開の未来回戦を取りに行かない。entriesと`matches?round=N`をentryIdで結合し、duemaIdをDMP IDとして優先、欠落時は大会内entryIdを使用する。

公開API確認元：[イベント情報](https://boi0m28318.execute-api.ap-northeast-1.amazonaws.com/v1/prod/events/dcb0aac1-ab7f-4261-b997-6614e93cc8d2)、[参加者](https://boi0m28318.execute-api.ap-northeast-1.amazonaws.com/v1/prod/events/dcb0aac1-ab7f-4261-b997-6614e93cc8d2/entries)、[第5回戦](https://boi0m28318.execute-api.ap-northeast-1.amazonaws.com/v1/prod/events/dcb0aac1-ab7f-4261-b997-6614e93cc8d2/matches?round=5)。2026-10-10に公開レスポンスのcurrentRound=5、entryId・duemaId、result・winnerIdの形式と過去回戦取得を読み取り確認した。

matchIdを試合キー、round・seatNumberを回戦・卓として保存。player1/player2はwinnerIdが該当entryIdと整合する場合のみ確定。byeは相手がなくwinnerIdが本人と一致する場合のみ専用状態。未知result、winner不一致、参加者欠落は未判定。droppedを保持し、過去の試合を除外・削除しない。非公開イベントは取得しない。固定公開APIホスト、リダイレクト禁止、リクエスト15秒・全体60秒、最大100回戦・10,000試合。

HTTP失敗や解析失敗が1ページ／1回戦でもあれば新しいスナップショット全体を保存せず、既存データを維持する。正しい形式の空回戦は書き込まず、既存のその回戦を維持する。TCGページ間の一部だけが空の場合は取得不整合として拒否する。

## 更新・削除の保護

- 全件の解析・検証が成功してからトランザクション内で保存する。
- `csInfo: []`、取得失敗、解析失敗は保存済みデータに書き込まない。
- 同じ回戦・卓の同一行は重複除外。競合行や同一回戦の参加者重複は拒否。
- 取得から省略された回戦は残す。
- 取得回戦が保存済みの全選手を含む場合はその回戦を入れ替え、卓変更や訂正を反映する。一部取得なら欠落卓を保持する。既存選手を欠落させる更新、二重出場になる組合せ変更は拒否して全件再取得を案内する。
- DB書き込み失敗時は回戦の入れ替えを含め全操作をロールバックする。
- 保存デッキは複製せず、同じDMP大会・提供元・外部キーの現在のメモを読み取る。現在のメモが存在する場合、明示的なデッキ解除を古い保存メモで復活させない。
- 入力中メモがなくなった場合のみ、同一大会の保存済みメモへフォールバックする。この場合デッキ編集は無効にする。
- 対戦表削除APIはID・DMP大会3項目・確認フラグを要求し、子試合だけをCASCADE削除する。既存の大会そのものの一括削除では、その大会の対戦表も外部キーに従って削除される。

取得は既存の固定APIホスト・リダイレクト禁止・12秒タイムアウトを再利用。全ラウンド解析は最大100回戦・10,000試合。一括INSERTで大量の逐次書き込みを避ける。

## API

| メソッド | パス | 用途 |
| --- | --- | --- |
| POST | `/api/matching-archives` | `{url, shopId, eventId, seq, tcgSettings?}` で全ラウンド保存・更新 |
| GET | `/api/matching-archives` | 保存済み大会一覧 |
| GET | `/api/matching-archives/:id` | 全回戦・勝敗・現在のデッキを参照 |
| POST | `/api/matching-archives/:id/delete` | `{confirmed:true, shopId, eventId, seq}` で対戦表のみ削除 |

既存 `POST /api/deck-memo/matching` にはのじぎくの `rounds` を追加し、最新回戦の従来フィールドは維持。既存デッキ保存API・テーブルはそのまま使用する。

## 検証

```sh
node --test tests/*.test.js tests/*postgres.integration.js
node tests/matching-archives.browser.cjs
node tests/three-provider-archives.browser.cjs
node tests/workspace-ui.browser.cjs
```

PostgreSQLテストはインメモリPGlite、ブラウザの対戦サイト取得はフィクスチャを使用する。Neonや環境変数DATABASE_URLには接続しない。Chromeパスは `CHROME_EXECUTABLE` で変更可能。

## 本番への反映手順（自動実行しない）

1. 検証環境で既存013の対戦表2テーブルと005の大会内プレイヤー用メモテーブルが存在することを確認する。
2. 既存のじぎく保存基盤が適用済みなら今回の本番DBマイグレーションは不要。013が未適用の環境では、先行実装の013を確認・バックアップした上で手動適用する。既存テーブルを更新・初期化しない。
3. 確認済みコードを手動でRenderへ反映する。今回git commit / push / デプロイ / 本番マイグレーションは行わない。
4. 消去前の対戦表で保存・再表示を確認し、既存メモ・大会結果が保持されることを確認する。旧来の `/api/setup-db` を本番マイグレーション代わりに呼び出さない。

コードを旧版へ戻しても追加テーブルは残せるため、ロールバックにテーブル削除は不要。

## 今回変更したファイル

- 共通保存：matching-archives.js、matching-archive-ui.js
- 取得：matching-providers/archive-results.js（追加）、sugatool-results.js（追加）、tcg-results.js、sugatool.js、nojigiku-results.js
- メモ：deck-memo-external.js（追加）、deck-memo.js、deck-memo-tcg.js、deck-memo-archives.js、deck-memo-ui.js
- 画面：index.html、style.css
- テスト：sugatool-results.test.js（追加）、three-provider-archives-postgres.integration.js（追加）、three-provider-archives.browser.cjs（追加）、helpers/three-provider-fixtures.js（追加）、tcg-results.test.js、sugatool.test.js、matching-archives-postgres.integration.js

未対応：TCG決勝トーナメント、スガツールの別APIにある決勝ブラケット／非公開データ、自動定刻保存、デッキ別・対面別勝率の集計画面。大会条件が確認できないTCGの最終回戦・開始得点欠落・0/0は推測で確定しない。
