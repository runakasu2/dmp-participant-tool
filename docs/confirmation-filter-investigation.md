# 参加確定フィルター調査（2026-11-07）

> 以下は受付済みを判定に使う変更前の調査記録です。その後、大会運営から「受付済み＝参加費支払い済み」と確認されたため、現在はスガツールのisReception、のじぎくのpaidで判定しています。エントリー確定だけでは対象に含めません。

## 確認した公開サイト

- Render: https://dmp-participant-tool-1.onrender.com/?format=original
- 大会: https://sugatool.nojigikucs.com/events/73039efc-e0b5-46ee-9169-2bd4892faeef/entries
- 参加者API: https://boi0m28318.execute-api.ap-northeast-1.amazonaws.com/v1/prod/events/73039efc-e0b5-46ee-9169-2bd4892faeef/entries

Renderから配信中のscript.jsとcheckin-participants.jsを直接取得して調査しました。公開サイトのDB更新APIは呼び出していません。ユーザーが表示しているブラウザー内の取得済みDMP名簿は読み取っていないため、その87件の個別ID照合結果までは未確認です。

## 結果

1. 配信中の切替イベントは一覧と集計の両方を再描画しています。
2. DMP参加表明者は外部全名簿のstatusParticipantsとDMP IDで照合しています。不一致はconfirmed=nullとなり、確定者のみのモードから除外されます。のじぎくの内部IDはDMP IDとみなしません。
3. 判定はスガツールのentryStatus=confirmed、のじぎくのconfirmed=trueです。**参加費支払済みの判定ではありません。**
4. 絞り込み条件はconfirmed===trueだけです。未確定・不明者を許可する条件はありません。
5. 一覧と母数集計はcurrentPredictionTargetsを共用します。使用率・不明者数・円グラフも同じ集計から作ります。

## 87人表示の原因

- 一覧上部のparticipant-countはDMP取得成功時のdata.countだけを表示しており、外部取得やフィルター切替では更新されていませんでした。このため、実際の対象人数が変わっても「取得件数：87人」が残り得ます。
- 参照APIの調査時点では全95件のうちentryStatus=confirmedが87件、waitlistedが8件、isReception=trueが80件でした。エントリー確定を条件とする現在のフィルターでは、照合済みDMP参加者が全員confirmedなら人数が変わらないのは仕様上あり得ます。80件の受付済みを支払済みと解釈する根拠はありません。

公開EntriesTabのコードでもentryStatusは「参加確定／キャンセル待ち」、isReceptionは「受付済み」として扱われています。公開参加者APIにpaid・paymentStatus等の支払確認項目はありませんでした。チェックイン・受付から支払済みを推測する実装は追加していません。

のじぎくの参照APIにはpaid、confirmed、checkedInが別々の真偽値として存在します。これらは同義ではなく、現在の確定フィルターではpaidを使っていません。

## 修正と検証

- participant-countを「表示・集計対象：N人（全参加者：M人）」として共通の再描画処理で更新します。
- 画面上の古い「DMP参加表明者は通常どおり集計」という説明を修正し、未確定・未確認者が除外されることを明記しました。
- 参加確定と参加費支払済みが別であること、スガツールの支払状態は確認できないことを表示しました。
- ブラウザーテストで、外部情報取得前の未確認DMP参加者が全員除外されること、取得後の一覧・人数・集計・円グラフが同期すること、解除時の復元と手動予想維持を検証しました。
- 全303テスト通過。実行: `node --test --test-concurrency=1 --test-timeout=60000 tests/*.test.js`

DB変更・コミット・push・デプロイは行っていません。
