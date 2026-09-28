# 大会一覧からのリセット

通常時はチェック欄を非表示にし、大会行クリックで詳細を開く。
一覧最下部の控えめな「大会を削除」で削除選択モードに入る。この時点では確認・API呼び出しはない。
削除モードではチェック欄と選択数、全選択・選択解除・キャンセル・選択した大会を削除を表示する。
行クリックは選択ON/OFFとなり、詳細へ移動しない。キャンセルで選択を解除して通常表示へ戻る。
「選択した大会を削除」で大会名・日付・ShopID/EventID/Seqを含む確認を2回表示し、
両方でOKの場合だけ既存APIを呼ぶ。選択0件・処理中は削除不可。
成功後は通常表示へ戻り、一覧を再取得する。失敗時は選択を保持して再試行できる。

## API / DB

`POST /api/events/reset`

```json
{"eventIds":[1,2],"confirmed":true}
```

成功：`{"success":true,"deletedEventCount":2}`

- 正の整数IDを1〜1000件受け付ける。重複・不正ID・確認なしは400。
- 存在しないIDが含まれる場合は409で全体を取り消す。
- SERIALIZABLE transactionで全削除を実行し、失敗時はROLLBACK。
- 外部キーのないdeck_historyは既存保存処理と同じテーブルロックで直列化する。
- eventsとメモ大会行をロックし、子テーブルを先に削除、eventsを最後に削除する。
- 原因はサーバーログに出し、DB例外・SQLをレスポンスに含めない。

対象テーブル：

- event_results
- deck_history（eventsとのShopID + EventID + Seq完全一致）
- event_deck_predictions
- deck_memos / deck_memo_roster
- deck_memo_external_players / deck_memo_dmp_candidates（旧TCG候補も対象）
- deck_memo_events
- deck_memo_archive_players / deck_memo_archives
- events

players、decks、deck_aliasesは削除しない。
別大会の全データと、DMP大会に紐付いていない旧admin単位のメモも残す。
同じnojigiku admin・TCG tidを使っていても、DMP大会の関連が異なれば対象外。
既存の「保存済みメモだけのリセット」は従来どおり別機能として残す。

## 反映

追加migrationは不要。既存の001〜005が適用されているDBを使用する。
ローカルはサーバー再起動・ブラウザ再読み込み。
Renderは変更ファイルをコミット・push、デプロイ完了後にブラウザを再読み込みする。

新規：event-reset.js、event-reset-ui.js、tests/event-reset.test.js、
tests/event-reset-ui.test.js、tests/event-reset-postgres.integration.js、この文書。
変更：server.js、script.js、index.html、style.css。

## 検証

```sh
node --test tests/*.test.js
NODE_PATH=/tmp/dmp-tcg-validation/node_modules node --test tests/event-reset-postgres.integration.js
```

後者は一時領域に `@electric-sql/pglite` を用意して実行する隔離PostgreSQLエンジンテスト。
本番DBやローカルアプリの接続先には接続しない。
大会Aのみ・複数大会・同EventID別ShopID/Seq・同admin/tid・未紐付け旧メモ・
グローバルマスター保持・存在しないID・重複ID・途中失敗の全ロールバックを検証する。
本番データを動作確認のために削除していない。
