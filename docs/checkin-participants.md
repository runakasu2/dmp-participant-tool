# 外部チェックイン参加者

## 操作

1. 参加表明画面でDMP大会URLから参加者を取得します。
2. スガツールの `https://sugatool.nojigikucs.com/events/{UUID}/entries`（matchesも可）、またはのじぎくの `https://nojigikucs.com/users-manage?admin={管理名}` を入力します。
3. 「当日枠を取得・再取得」で取り込みます。同じ取得元の再取得は一覧を更新し、受付・チェックインの両方が解除された当日枠は一覧から除かれます。取得失敗では一覧を変更しません。
4. 初期状態は全参加者の表示・集計です。「参加確定者のみ」を選ぶと、DMP参加表明者と当日枠の両方でconfirmedがtrueの参加者だけを一覧・母数・円グラフに反映します。外部名簿にないDMP参加表明者は未確認として除外します。解除すれば全員に戻ります。
5. スマートフォンでは参加者行の「詳細」を開いて手動予想を編集します。

## 統合と保存

- 受付済み、またはチェックイン済みの外部参加者を当日枠として追加します。確定者のみの表示・集計は受付済みだけです。DMP参加者の状態照合には全名簿を使います。
- DMP IDは文字列で照合し、先頭ゼロを維持します。名前の一致では統合しません。
- スガツールの `duemaId` が有効な場合は既存のプレイヤー登録・直近3大会履歴・自動予想・手動予想APIを使用します。既存参加者と重複する場合は既存の名前と予想を維持します。
- のじぎくの `id` はDMP IDとの同一性が未確認のため、DMPへ保存しません。サービス・大会・外部参加者IDのキーで区別し、履歴照合なし・自動予想不明として集計します。手動予想は `checkin_predictions` に保存します。
- `confirmed` はアプリ内の参加確定（受付済み）を表します。スガツールは `isReception === true`、のじぎくは `paid === true` を使用します。欠落・nullは未確認で除外し、文字列などの不正な型は拒否します。大会運営による「受付済み＝参加費支払い済み」の確認に基づく判定です。
- 元のエントリー確定状態は `entryConfirmed` と `entryStatus` に保持し、フィルターには使いません。チェックインはスガツールの `checkInAt`（明示的なcheckedInがある場合はそれ）、のじぎくの `checkedIn` として分離します。ドロップ情報は判定・表示に使いません。
- 集計関数 `buildPredictionSummary` は変更せず、渡す参加者だけを絞ります。
- 取り込んだ名簿・取得元URL・状態は画面内で保持します。ページを再読み込みしたらDMPと外部を再取得してください。保存した手動予想は同じ大会・参加者で再表示されます。
- 外部DMP IDが変更された場合や、別サービス同士でDMP ID未確認の場合は自動統合しません。

## API

- `POST /api/checkin-participants`: `{shopId,eventId,seq,sourceUrl}`。外部チェックインと履歴・予想を返します。
- `PUT /api/checkin-prediction`: `{shopId,eventId,seq,externalKey,mode,deckId}`。DMP ID未確認参加者の手動予想。modeはmanual/auto、manualのdeckId=nullは明示的不明です。
- DMP IDがある参加者は既存 `PUT /api/event-deck-prediction` を使用します。

## DBとRender

マイグレーション `migrations/016_checkin_predictions.sql` が必要です。既存データを削除せず、新規テーブルだけを追加します。デッキ統合と大会リセットはこのテーブルも処理します。

デプロイが承認された後の手順:

1. 変更をレビューし、通常の手順でコミット・pushします。
2. Renderの対象サービスで既存のDATABASE_URLが設定されていることを確認します。
3. 本番DBに016のSQLを適用します（既存の `/api/setup-db` にも追加済み。直接SQL実行を推奨）。新しいサーバーコードを有効化する前に適用できます。
4. Renderで該当リビジョンをデプロイします。起動コマンドは従来どおり `npm start` です。
5. DMP取得、外部取得、手動予想の保存・再取得、確定者フィルターを確認します。

この実装作業ではコミット・push・本番DB変更・Renderデプロイを実行していません。

## 取得制限

接続先は固定の公開APIだけです。入力元ドメイン・URL形式を許可リストで検証し、リダイレクト禁止、15秒タイムアウト、2MiBのストリーム上限、1万行上限、データ形式検証を行います。認証回避は行いません。APIの公開状態、実データの最新スキーマ、のじぎくIDのDMPとの同一性は未検証です。テストはモックAPIを使用します。

## 変更ファイル

- `checkin-participants.js`: URL検証、容量制限付き公開API取得、正規化、ID統合、集計対象選択。
- `server.js`: 共通の履歴・予想取得処理、2つのAPI、移行SQL登録、デッキ統合時の外部予想移行。
- `script.js` / `index.html`: 外部取得、参加状態、人数、集計切替、既存の予想編集UIとの接続。
- `event-reset.js`: 大会リセット時の外部手動予想削除。
- `migrations/016_checkin_predictions.sql`: DMP ID未確認参加者の予想テーブル。
- `tests/checkin-participants.test.js` / `tests/checkin-ui.test.js`: API・統合・DB・ブラウザー操作テスト。
- `tests/deck-merge.test.js` / `tests/deck-pie.test.js`: 新しい保存先と集計対象選択に対応する既存テスト更新。
- `docs/checkin-participants.md`: この操作・移行・制約説明。

`dmp-participants.js` と `prediction-summary.js` は変更していません。

## 参加確定フィルターの更新

追加のDB変更は不要です。既存APIの `statusParticipants` はチェックイン前も含む正規化済みの状態を返し、`participants` は受付済み、またはチェックイン済みを返します。複数取得元で確定状態が競合する場合は未確認として扱います。フィルターは表示と集計に渡す配列だけを変え、予想・履歴・元の名簿を削除しません。

受付済みの判定に変更済みです。エントリー確定87件、受付済み80件のモックで、DMPとのID照合後の対象が80件になること、使用率・不明者数・手動予想・履歴の保持をテストします。追加のDB変更は不要です。
