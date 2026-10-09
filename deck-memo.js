const {parseSugatoolUrl,fetchSugatool} = require('./matching-providers/sugatool');
const {parseTcgUrl} = require('./matching-providers/tcg-meister');
const {loadTcgMemo, updateTcgMemo} = require('./deck-memo-tcg');
// Verified against the public nojigikucs.com application bundle (2026-09-28).
// Never derive this destination from user input; never follow redirects.
const API_BASE = 'https://axirq5jhn9.execute-api.ap-northeast-1.amazonaws.com/v1/';
const fail = (message, status = 400) => Object.assign(new Error(message), {status});

function parseMemoUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw fail('マッチングサイトのURLを入力してください。'); }
  if (url.protocol !== 'https:' || url.hostname !== 'nojigikucs.com' || url.port || url.username || url.password) {
    throw fail('https://nojigikucs.com/ のURLを指定してください。');
  }
  const values = url.searchParams.getAll('admin');
  if (!values.length || (values.length === 1 && !values[0])) {
    throw fail('nojigikuのURLからadminを取得できませんでした。');
  }
  if (values.length !== 1 || !/^[A-Za-z0-9_-]{1,100}$/.test(values[0])) {
    throw fail('nojigikuのadminの形式が不正です。英数字・ハイフン・アンダースコアで指定してください。');
  }
  return {adminKey: values[0], sourceUrl: 'https://nojigikucs.com/?' + new URLSearchParams({admin: values[0]})};
}

async function fetchSource(endpoint, adminKey, fetchImpl = fetch) {
  const url = new URL(endpoint, API_BASE);
  url.searchParams.set('admin', adminKey);
  if (endpoint === 'get-users') url.searchParams.set('detail', 'true');
  try {
    const response = await fetchImpl(url.toString(), {
      redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(12000),
      headers: {'Accept': 'application/json', 'Cache-Control': 'no-cache'}
    });
    if (!response.ok) throw fail('対戦サイトの取得に失敗しました（HTTP ' + response.status + '）。', 502);
    let data;
    try {
      data = await response.json();
      if (typeof data === 'string') data = JSON.parse(data);
    } catch { throw fail('対戦サイトから正しいJSONを取得できませんでした。', 502); }
    const key = endpoint === 'get-users' ? 'users' : 'csInfo';
    if (!data || !Array.isArray(data[key])) throw fail('対戦サイトのデータ形式が不正です。adminを確認してください。', 502);
    return data[key];
  } catch (error) {
    if (error.status) throw error;
    if (['TimeoutError', 'AbortError'].includes(error.name)) throw fail('対戦サイトへの接続がタイムアウトしました。再取得してください。', 504);
    throw fail('対戦サイトに接続できませんでした。時間をおいて再取得してください。', 502);
  }
}

function latestMatching(matches, users = []) {
  if (!matches.length) return {latestRound: null, participants: []};
  const positiveInteger = value => /^(?:[1-9]\d*)$/.test(String(value)) && Number.isSafeInteger(Number(value));
  if (matches.some(match => !match || !positiveInteger(match.round) || !positiveInteger(match.table))) {
    throw fail('対戦サイトのラウンド・卓番号が不正です。', 502);
  }
  const latestRound = matches.reduce((round, match) => Math.max(round, Number(match.round)), 0);
  const names = new Map(users.filter(user => user && user.id != null && typeof user.name === 'string' && user.name.trim())
    .map(user => [String(user.id), user.name.trim()]));
  const participants = [];
  const seen = new Set();
  for (const match of matches.filter(match => Number(match.round) === latestRound).sort((a, b) => Number(a.table) - Number(b.table))) {
    for (const side of [1, 2]) {
      const id = String(match['user' + side + 'id'] ?? '');
      // A bye/empty seat may not carry a DMP ID. It is not a player.
      if (!id || id === '0') continue;
      // Nojigiku represents the absent opponent of a bye with -1 (not a player ID).
      if (id === '-1' && String(match['user' + side + 'no']) === '-1' &&
          /^Bye\s*[（(]不戦勝[）)]$/i.test(String(match['user' + side] || '').trim())) continue;
      if (!/^\d{1,50}$/.test(id)) throw fail('nojigikuの対戦表に不正な参加者DMP IDが含まれています。URLのadminではなく、取得データを確認してください。', 502);
      if (seen.has(id)) throw fail('最新ラウンドに同じDMP IDが重複しています。', 502);
      seen.add(id);
      const fallback = String(match['user' + side] || '').replace(/\s*[（(]\s*\d+\s*点\s*[）)]\s*$/, '').trim();
      participants.push({dmpId: id, name: names.get(id) || fallback || '名前未取得',
        table: Number(match.table), side, entryNo: match['user' + side + 'no'] ?? null});
    }
  }
  return {latestRound, participants};
}

function detectProvider(value) {
  let url;
  try {url = new URL(value);} catch {throw fail('マッチングサイトのURLを入力してください。');}
  if (url.hostname === 'sugatool.nojigikucs.com') return parseSugatoolUrl(value);
  if (url.hostname === 'tcg.sfc-jpn.jp') return parseTcgUrl(value);
  return {provider:'nojigiku', ...parseMemoUrl(value)};
}

function installMemoRoutes(app, pool, fetchImpl = fetch, fetchEventDetail = null) {
  // Old clients must not keep creating draft-level DMP mappings.
  app.put('/api/deck-memo/player-mapping', (req, res) => {
    res.status(410).json({success:false,error:'DMP対応は大会結果のデッキメモ反映プレビューで選択してください。画面を再読み込みしてください。'});
  });
  app.post('/api/deck-memo/matching', async (req, res) => {
    try {
      const source = detectProvider(req.body?.url);
      const {adminKey, sourceUrl} = source;
      let detail = null;
      if (req.body?.detailUrl !== undefined) {
        if (!req.body.detailUrl || !fetchEventDetail) throw fail('DMPランキング大会詳細URLを入力してください。');
        try { detail = await fetchEventDetail(req.body.detailUrl); }
        catch { throw fail('DMPランキングの大会情報を取得できませんでした。URLを確認してください。', 502); }
        if (!detail.eventName || !detail.eventDate) throw fail('DMPランキングから大会名・開催日を取得できませんでした。', 502);
      }
      if (source.provider === 'tcg_meister') {
        const result = await loadTcgMemo({source, detail, pool, fetchImpl});
        res.set?.('Cache-Control', 'no-store');
        return res.json(result);
      }
      let matching,allRounds=null,users={rows:[]};
      if(source.provider==='sugatool')matching=await fetchSugatool(source,fetchImpl);
      else {
        const [matches, fetchedUsers] = await Promise.all([
          fetchSource('get-cs-info', adminKey, fetchImpl),
          fetchSource('get-users', adminKey, fetchImpl).then(rows => ({rows}), () => ({rows: [], failed: true}))
        ]);
        users=fetchedUsers;matching=latestMatching(matches,users.rows);
        allRounds=require('./matching-providers/nojigiku-results').normalizeNojigikuMatches(matches,users.rows);
      }
      const rosterParticipants=allRounds?[...new Map(allRounds.flatMap(r=>r.participants).filter(p=>p.dmpId).map(p=>[p.dmpId,p])).values()]:matching.participants;
      let event;
      if (detail) {
        const linked = await pool.query(`
          INSERT INTO events (shop_id, event_id, seq, event_name, event_date, format)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (shop_id, event_id, seq) DO UPDATE SET
            format=COALESCE(events.format,EXCLUDED.format), event_name = EXCLUDED.event_name, event_date = EXCLUDED.event_date, updated_at = CURRENT_TIMESTAMP
          RETURNING id,format
        `, [detail.shopId, detail.eventId, detail.held, detail.eventName, detail.eventDate,detail.format || null]);
        detail.format=linked.rows[0].format || null;
        event = await pool.query(`
          INSERT INTO deck_memo_events (source, admin_key, source_url, event_record_id)
          VALUES ($4, $1, $2, $3)
          ON CONFLICT (source, admin_key, event_record_id) DO UPDATE SET
            source_url = EXCLUDED.source_url, updated_at = CURRENT_TIMESTAMP RETURNING id
        `, [adminKey, sourceUrl, linked.rows[0].id,source.provider]);
        if (rosterParticipants.length) {
          await pool.query(`
            INSERT INTO deck_memo_roster (memo_event_id, dmp_id, handle_name, entry_no, table_no, round)
            SELECT $1::integer, x.id, x.name, x.entry, x.table_no, COALESCE(x.round,$3::integer)
            FROM jsonb_to_recordset($2::jsonb) AS x(id varchar(50), name text, entry text, table_no integer, round integer)
            ON CONFLICT (memo_event_id, dmp_id) DO UPDATE SET
              handle_name = EXCLUDED.handle_name, entry_no = EXCLUDED.entry_no,
              table_no = EXCLUDED.table_no, round = EXCLUDED.round
          `, [event.rows[0].id, JSON.stringify(rosterParticipants.map(p => ({id:p.dmpId, name:p.name,
            entry:p.entryNo == null ? null : String(p.entryNo), table_no:p.table,round:p.round??matching.latestRound}))), matching.latestRound]);
        }
      } else {
        event = await pool.query(`
          INSERT INTO deck_memo_events (source, admin_key, source_url) VALUES ($3, $1, $2)
          ON CONFLICT (source, admin_key) WHERE event_record_id IS NULL DO UPDATE SET
            source_url = EXCLUDED.source_url, updated_at = CURRENT_TIMESTAMP RETURNING id
        `, [adminKey, sourceUrl,source.provider]);
      }
      const memos = await pool.query(`
        SELECT m.dmp_id, m.deck_id, d.name AS deck_name FROM deck_memos m
        JOIN decks d ON d.id = m.deck_id WHERE m.memo_event_id = $1
      `, [event.rows[0].id]);
      const byId = new Map(memos.rows.map(memo => [memo.dmp_id, memo]));
      const participants = matching.participants.map(player => ({...player,
        deckId: byId.get(player.dmpId)?.deck_id ?? null, deckName: byId.get(player.dmpId)?.deck_name ?? null}));
      res.set?.('Cache-Control', 'no-store');
      res.json({success: true, provider: source.provider, event: detail, format:detail?.format || matching.format || null, adminKey, sourceUrl, memoEventId: event.rows[0].id,
        ...(allRounds?{rounds:allRounds.map(r=>({...r,participants:r.participants.map(p=>({...p,deckId:byId.get(p.dmpId)?.deck_id??null,deckName:byId.get(p.dmpId)?.deck_name??null}))}))}:{}),
        latestRound: matching.latestRound, participants, participantCount: participants.length,
        registeredCount: participants.filter(player => player.deckId !== null).length,
        warning: matching.warning || (users.failed ? '参加者名一覧を取得できなかったため、対戦表の名前を表示しています。' : null)});
    } catch (error) {
      console.error('対戦表取得エラー:', error.message);
      res.status(error.status || 500).json({success: false, error: error.status ? error.message : 'デッキメモを読み込めませんでした。DB初期化と接続を確認してください。'});
    }
  });

  app.put('/api/deck-memo', async (req, res) => {
    let client, active = false, releaseError;
    try {
      const source = detectProvider(req.body?.url);
      if (source.provider === 'tcg_meister') return res.json(await updateTcgMemo(pool, source, req.body));
      const {adminKey} = source;
      const {dmpId, deckId, memoEventId} = req.body || {};
      if (memoEventId !== undefined && (!Number.isInteger(memoEventId) || memoEventId <= 0 || memoEventId > 2147483647)) throw fail('メモ大会IDが不正です。');
      if (typeof dmpId !== 'string' || !/^\d{1,50}$/.test(dmpId) || /^0+$/.test(dmpId) ||
          (deckId !== null && (!Number.isInteger(deckId) || deckId <= 0 || deckId > 2147483647))) {
        throw fail('DMP IDまたはデッキの指定が不正です。');
      }
      client = await pool.connect();
      await client.query('BEGIN'); active = true;
      // Match the merge locking order: deck before memo row.
      let deck = null;
      if (deckId !== null) {
        const selected = await client.query('SELECT id, name FROM decks WHERE id = $1 FOR KEY SHARE', [deckId]);
        if (!selected.rows.length) throw fail('デッキが見つかりません。対戦表を再取得してください。', 404);
        deck = selected.rows[0];
      }
      const event = memoEventId === undefined
        ? await client.query("SELECT id FROM deck_memo_events WHERE source = $2 AND admin_key = $1 AND event_record_id IS NULL", [adminKey,source.provider])
        : await client.query("SELECT id FROM deck_memo_events WHERE source = $3 AND admin_key = $1 AND id = $2", [adminKey, memoEventId,source.provider]);
      if (!event.rows.length) throw fail('先に最新の対戦表を取得してください。', 404);
      if (deckId === null) {
        await client.query('DELETE FROM deck_memos WHERE memo_event_id = $1 AND dmp_id = $2', [event.rows[0].id, dmpId]);
      } else {
        await client.query(`
          INSERT INTO deck_memos (memo_event_id, dmp_id, player_id, deck_id)
          VALUES ($1::integer, $2::varchar(50),
            (SELECT id FROM players WHERE dmp_id = $2::varchar(50)), $3::integer)
          ON CONFLICT (memo_event_id, dmp_id) DO UPDATE SET
            deck_id = EXCLUDED.deck_id, player_id = EXCLUDED.player_id, updated_at = CURRENT_TIMESTAMP
        `, [event.rows[0].id, dmpId, deckId]);
      }
      await client.query('COMMIT'); active = false;
      res.json({success: true, deckId: deck?.id ?? null, deckName: deck?.name ?? null});
    } catch (error) {
      if (active) {
        try { await client.query('ROLLBACK'); } catch (rollbackError) { releaseError = rollbackError; }
      }
      console.error('デッキメモ保存エラー:', error.message);
      res.status(error.status || 500).json({success: false, error: error.status ? error.message : 'デッキメモを保存できませんでした。再度お試しください。'});
    } finally { if (client) client.release(releaseError); }
  });
}

module.exports = {detectProvider, parseMemoUrl, fetchSource, latestMatching, installMemoRoutes};
