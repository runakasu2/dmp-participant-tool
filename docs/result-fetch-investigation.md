# 大会結果取得の調査（2026-11-10）

対象: https://www.dmp-ranking.com/event.asp?ShopID=107&EventID=351&Seq=2

2026/11/09開催。定員64人とは別に、公式結果ページ `result.asp?ShopID=107&EventID=351&Seq=2` の `tr[onclick^="UserResult("]` を数え、実際の登録が64行あることを確認した。順位あり45行、順位なし19行。順位は2列目の `数字位` または `－`、名前は3列目。参加表明一覧は使用していない。

新しい結果ページ `/Deckbuild/Event/EventResult?year=2026&shop=107&event=351&held=2` はJavaScriptから結果API `EventResult.aspx/GetResultRanking` にPOSTする。応答は `{d: "JSON配列"}`。順位あり・なしは同じオブジェクト形式で、`会員ID`、`ハンドルネーム`、`成績ID` を持ち、順位なしでは `順位` が空文字になる。

API実測: offset=0 は30件、30は16件（順位31〜45と空順位の鬼龍）、46〜63は各1件、64は空配列。短いページを終端とみなしたため、旧処理は46人（順位あり45、なし1）で終了していた。公式ページ自身にも30件未満で終了するJavaScriptがあるが、それを踏襲すると今回のAPI応答を全件取得できない。API内部で1件ずつになる理由は公開情報からは確定できない。

修正後は空配列まで取得し、offsetを応答行数だけ進める。DMP IDで重複排除し、空順位はそのまま保持する。結果は64人（順位あり45、なし19）、公式HTML全行との名前・順位比較が一致。架空の登録者は追加しない。30000行の保護上限は今回の件数に無関係。

追加取得された18人（DMP ID / 名前）:

- 3716 / KG
- 47007 / マサイ
- 58789 / Aki。
- 63018 / ♪ユウキ♪
- 56959 / 毒林檎トーテム
- 154011 / もっっちゃん
- 82655 / マリコロコロ
- 178435 / まきひこ
- 147389 / PARO
- 78295 / とろろ昆布
- 43884 / かいそら/はっちCS
- 4070 / Gonbe
- 43131 / みれちゃそ
- 133623 / あまたか
- 15700 / ダンゴムシ
- 64765 / たこやき、
- 171653 / ゆがっぷ/MCD
- 169626 / きよじ

参加確定フィルターは参加表明・予想側にあり、結果取得の両ルート `/api/event-result-from-detail` と `/api/event-result` では使用されていない。結果表示側にも空順位を除外する処理はない。保存処理は空順位をNULLとして扱い、既存レコードへのupsertを継続する。デッキ登録・保存処理、マイグレーションは変更していない。検証は公開ページの読み取りとモック／隔離DBのみで、実際の保存済みデータへの操作は行っていない。

回帰テストの入力は tests/fixtures/dmp-results-107-351-2.json（API実応答）、dmp-results-107-351-2-html.json（Shift_JIS公式HTMLから抽出した順位・名前の全行）。先頭2ページで旧挙動46人になること、修正後の64人と空順位19人、HTML照合、全64人の保存、DMP ID重複排除とoffsetを検証する。

検証結果:

- `node --test tests/event-results.test.js`: 13/13成功（追加2件を含む）。
- `node --test --test-concurrency=1 --test-timeout=60000 tests/*.test.js tests/*postgres.integration.js`: 全322件中321件成功。`tcg-memo-postgres.integration.js:134` がテストDBの `checkin_predictions` テーブル不足でデッキ統合HTTP 500となる。変更前のHEAD版server.jsを読み込ませても同じ失敗を確認。
- `tests/*.browser.cjs` 全14ファイルを実行し12成功。`provisional-results.browser.cjs:46` は保存一覧先頭の無効な「前へ」ボタンのクリック待ちでタイムアウト、`workspace-ui.browser.cjs:111` は画面レイアウトのassertで失敗。いずれもHEAD版server.jsで同じ箇所・症状を再現。今回の修正範囲には含めていない。
- `git diff --check`: 成功。

変更ファイル: server.js、tests/event-results.test.js、tests/fixtures/dmp-results-107-351-2.json、tests/fixtures/dmp-results-107-351-2-html.json、本調査記録。既存の未コミットファイルには手を加えていない。コミット・push・デプロイは未実施。
