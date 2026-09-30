# 代表カード画像のアップロード

## Supabase Storage設定

作成済みのPublic bucket `deck-images` を利用します。JPEG / PNG / WebP、5MB上限を設定してください。
ローカルのサーバープロセスとRenderのWeb Service → Environmentの両方に以下を設定します。

- SUPABASE_URL: Supabase Project URL（https://<project>.supabase.co）
- SUPABASE_SECRET_KEY: Secret API Key（サーバー専用）
- SUPABASE_STORAGE_BUCKET: 任意。未設定時deck-images

Secret keyをGitへコミットしたり、HTML・フロントJSへ記載しないでください。設定値をブラウザに渡す必要はありません。
ローカルは環境変数を設定したターミナルでnode server.jsを起動します。Renderは環境変数保存後に再デプロイしてください。
旧ストレージ用の環境変数は不要なのでRenderから削除できます。

ブラウザ → Express → Supabase Storageの順に送信します。専用admin clientでSDK標準の認証処理を利用します。
保存パスは `decks/{deckId}/{timestamp}-{UUID}.{jpg|png|webp}`。元ファイル名は利用せず、上書きもしません。
アップロードが成功した後、Public URL `SUPABASE_URL/storage/v1/object/public/{bucket}/{path}` を生成し、DB更新が成功した時だけ保存完了を返します。
公式仕様: https://supabase.com/docs/guides/storage/serving/downloads
Node.js 22以上を使用してください。@supabase/supabase-js 2.117.2を利用します。

今回はmigration不要。既存decks.image_urlを利用します。007未適用の環境のみ先に/api/setup-dbを実行してください。

## 利用方法

デッキ管理でファイルを選ぶと未保存のプレビューが表示されます。「選択した画像をアップロード」を押すと保存します。
URL欄を入力する方法も残しており、「代表画像を保存」で確定します。空欄で画像の関連付けを解除できます。
JPEG / PNG / WebP、最大5MiB（画面表記5MB）。サーバーでもContent-Type、ファイル署名、サイズを検証し、Supabaseへ送信する前に拒否します。

POST /api/decks/:id/image/upload は画像バイナリをリクエスト本文として受けます。元画像はSupabase Storageへ保存し、成功後のみdecks.image_urlを更新します。
サーバーのローカルディスクやPostgreSQLに画像バイナリを永続保存しません。
画像変更・デッキ統合・大会削除によってSupabase Storageの元画像を自動削除しません。保存後のDB更新失敗時にもSupabase Storageには画像が残る場合があります。

## 表示用crop

元画像の横7〜93%、縦14〜60%をイラスト領域の初期値として、表示枠を覆う倍率で拡大します。位置はその領域の中央です。
CSSのoverflow:hiddenと、画像の自然サイズ・表示枠サイズから計算したwidth/height/left/topを使い、画面幅の変更にも追従します。
大会一覧と保存前プレビューは同じcard-art.jsを使います。元カード全体のプレビューはobject-fit:containで表示します。
背景には既存の暗いグラデーションを重ねます。画像なし・読込失敗時は共通背景になります。
特殊なカードレイアウトでは文字が入る可能性があります。今回は位置調整の保存機能は追加していません。

## 実機確認

1. JPEG / PNG / WebPを選び、元カード全体と背景の両プレビューを確認。
2. アップロード後、再読込して画像が残ることを確認。
3. 該当デッキを使用した優勝者がいる大会の一覧を更新し、背景を確認。
4. URL入力・解除も確認。
5. 5MiB超・非対応形式を拒否することを確認。
6. スマホのファイル選択と縦横回転時の背景表示を確認。

自動テストではストレージ通信をモックしています。認証情報を設定した実Supabase Storageへの通信とスマホ実機表示は利用環境で確認してください。

既存の画像URLは自動で書き換えません。旧ストレージの画像を移す場合はデッキ管理から同じ元画像を再アップロードしてください。旧ストレージを停止する前に移行後の表示を確認してください。

## Admin SDK update

Uploads now use @supabase/supabase-js 2.117.2. Node.js >=22 is required (local verification: 24.21.0).
Run npm ci and restart the server; deploy Render with Node.js >=22.
The dedicated server client receives SUPABASE_URL and SUPABASE_SECRET_KEY directly.
persistSession, autoRefreshToken and detectSessionInUrl are all false.
No user session, browser client, or custom Authorization header is used.
Storage.upload() saves the file; Storage.getPublicUrl() supplies the public URL.
The sb_secret_ key is accepted without JWT validation. Do not add a public INSERT policy.
The old implementation sent only apikey via manual REST; authentication is now handled by the SDK.
The exact cause of the observed 403 still requires a retry against the configured project.
