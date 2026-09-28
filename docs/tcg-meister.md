# TCGマイスター：開催中のメモと終了後の反映

## 今回の修正

前の仕様では取得時にDMP参加者・結果とHN照合し、その結果をメモ画面に表示していた。
照合を行うタイミングを、**保存済みメモの大会結果反映プレビュー**へ変更した。

### 開催中

1. TCGマイスターの最初のURLと、同じ大会のDMPランキング大会詳細URLを入力する。
2. 「大会情報・最新対戦表を取得」。DMP URLは大会名・日付・ShopID/EventID/Seq取得にだけ使用する。
3. 「卓／ハンドルネーム／使用デッキ」の3列で記録する。DMP ID・HN一致・DMP選択欄は出ない。
4. 最新ラウンドを再取得してもデッキは残る。
5. 「この大会のデッキメモを保存」。デッキ未選択者も保存される。
6. 保存済み一覧・詳細はDBだけから表示できる。TCG詳細でもDMP対応欄は表示しない。

この段階ではDMP参加表明一覧・大会結果・players・event_resultsへプレイヤー照合のための
アクセスを行わない。DMP結果未公開でもメモできる。

### 終了後

1. 同じDMP大会の大会結果を取得する。
2. 「デッキメモを大会結果に反映」を開く。
3. プレビューで保存時のTCG HNと、**同大会のevent_resultsに存在するプレイヤー**のHNを照合する。
4. 完全一致で一意なら「HN一致」。一致なし・同名複数なら、取得済み大会結果の候補から選ぶ。
5. 手動選択するとプレビューを再計算する。選択先に既存デッキがあれば競合になる。
6. 内容を確認して反映する。競合は既存保持が初期値、上書きは明示的な選択時のみ。

手動対応はこのプレビュー内で保持し、apply時に同じ選択を送ってサーバー側で再検証する。
キャンセル・再読み込み・プレビューの開き直し時は選び直す。選択操作だけではDBへ書き込まない。
同じDMPプレイヤーへの二重対応、大会結果にないID、改変したプレビュー情報は拒否する。
未対応者・デッキ未選択者は反映しない。繰り返し反映しても履歴を重複作成しない。順位は変更しない。

のじぎくは従来どおり、archiveのDMP IDで同大会結果と照合する。

## データ・互換性

- 大会識別：ShopID + EventID + Seq。`events` と関連付ける。
- TCG参加者：メモ大会（provider + tid + DMP大会）と内部参加者キーで識別する。
  内部IDがない場合はrawNoとHNから大会内キーを生成する。両方変わる場合は同一人物と推測しない。
- TCGメモ：HN、内部ID、rawNo、卓、Round、不戦勝、deck_idを保存する。
  `player_id / dmp_id` がNULLで正常。No.や内部番号をDMP IDとして扱わない。
- TCG archive保存ではDMP対応をコピーせず、HN・deck_id等をスナップショットする。
- 旧版のDMP候補テーブル・対応カラムは削除しない。旧対応値も照合根拠にしない。
  新しいプレビューは保存時HNから判定し直す。
- 旧開催中mapping APIは410と案内を返す。古い画面から対応を保存できない。
- デッキは既存の正式名selectとID参照を維持。名称変更・統合も従来どおり。
- 公開閲覧・最新Round・成績表除外・全ページ・不戦勝の取得処理は変更していない。

## migrationと反映手順

**今回の仕様修正では新しいmigrationは不要。**
前回の `005_tcg_meister_memos.sql` を適用済みなら、追加のDB操作は不要。
まだ適用していない場合だけ、新コード起動後に既存の `/api/setup-db` を実行する。

ローカル：`Ctrl+C` → `node server.js` → ブラウザ再読み込み。
Render：変更ファイルをコミット・push → デプロイ完了 → ブラウザ再読み込み。
本番DBの適用・初期化・削除は開発作業では実行していない。

確認の目安：
- 開催中のTCGメモは3列でDMP IDがなく、デッキ選択と再取得・保存ができる。
- 結果未公開でもメモを保存できる。
- 大会結果取得後にプレビューで初めてHN一致・手動対応が表示される。
- 旧HNを手動選択すると対応先の既存デッキと競合が再表示される。
- 未選択・未対応は反映されず、2回反映しても同大会同プレイヤーの履歴が増えない。

## 今回の変更ファイル

- `deck-memo-tcg.js`：開催中のDMP照合と対応保存を除去
- `deck-memo.js`：旧mapping APIの停止、TCG取得への結果取得関数の受け渡しを除去
- `server.js`：不要な結果取得関数の受け渡しを除去
- `deck-memo-archives.js`：TCG保存ではDMP ID/player_idを未確定として扱う
- `deck-memo-ui.js` / `index.html` / `style.css`：TCGメモ・詳細からDMP対応欄を除去
- `deck-memo-import.js` / `deck-memo-import-ui.js`：provider別プレビュー、手動選択と再検証
- **追加** `deck-memo-matching.js`：取得時から移したHN完全一致の共通関数
- **追加** `deck-memo-tcg-import.js`：同大会結果の一括取得・手動選択検証
- `tests/tcg-meister.test.js`：照合関数の移動に対応
- `tests/deck-memo-ui.test.js`：開催中3列・DMP欄なしを確認
- `tests/deck-memo-import-ui.test.js`：手動対応・競合再計算・失敗時復元を確認
- **追加** `tests/tcg-import.test.js`：結果側での照合・候補制限・token検証
- `tests/tcg-memo-postgres.integration.js`：2段階フローへ更新
- この文書

## テスト

```sh
node --test tests/*.test.js
```

隔離したPostgreSQLエンジンでSQL・migration・APIを確認する場合：

```sh
npm install --prefix /tmp/dmp-tcg-validation --no-audit --no-fund @electric-sql/pglite
NODE_PATH=/tmp/dmp-tcg-validation/node_modules node --test tests/tcg-memo-postgres.integration.js
```

PGliteはテスト用一時ディレクトリのみ。実DBへの接続は行わない。
開催中のプレイヤー問い合わせなし、未確定保存、結果後の自動/手動照合、
旧対応値の無視、候補制限、競合保持/上書き、反映の冪等性、順位不変、
のじぎくの保存・デッキ統合・リセット範囲を検証する。
