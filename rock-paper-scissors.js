const HANDS = ['rock', 'scissors', 'paper'];
function badRequest(message) { return Object.assign(new Error(message), {status: 400}); }
function validateRecord(body = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('入力内容が不正です。');
  const playerName = typeof body.playerName === 'string' ? body.playerName.trim() : '';
  if (!playerName || [...playerName].length > 100) throw badRequest('プレイヤー名を1〜100文字で入力してください。');
  if (!HANDS.includes(body.hand)) throw badRequest('じゃんけんの手を選択してください。');
  const dmpId = typeof body.dmpId === 'string' ? body.dmpId.trim() : '';
  const guestId = body.guestId;
  const createGuest = body.createGuest === true;
  if (Number(Boolean(dmpId)) + Number(guestId != null) + Number(createGuest) !== 1 ||
      (body.dmpId != null && (!dmpId || dmpId.length > 50)) ||
      (guestId != null && (!Number.isSafeInteger(guestId) || guestId < 1 || guestId > 2147483647))) {
    throw badRequest('候補からプレイヤーを選ぶか、新しい記録先を選択してください。');
  }
  return {playerName, hand: body.hand, dmpId, guestId, createGuest};
}
function summarizeHands(rows) {
  const counts = Object.fromEntries(HANDS.map(hand => [hand, 0]));
  for (const row of rows) if (HANDS.includes(row.hand)) counts[row.hand] = Number(row.count);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return {total, hands: HANDS.map(hand => ({hand, count: counts[hand],
    percentage: total ? Math.round(counts[hand] / total * 1000) / 10 : 0}))};
}
async function loadRpsSummary(db, {playerId, guestId}) {
  const column = playerId != null ? 'player_id' : 'guest_id';
  const result = await db.query(`SELECT hand, COUNT(*)::int AS count FROM rock_paper_scissors_records
    WHERE ${column} = $1 GROUP BY hand`, [playerId ?? guestId]);
  return summarizeHands(result.rows);
}
async function searchGuests(db, query) {
  // Treat wildcard characters literally in names.
  const pattern = '%' + query.replace(/[\\%_]/g, '\\$&') + '%';
  const result = await db.query(`SELECT id AS guest_id, NULL::text AS dmp_id, handle_name
    FROM rps_guests WHERE handle_name ILIKE $1 ORDER BY handle_name, id LIMIT 50`, [pattern]);
  return result.rows;
}
async function saveRecord(pool, input) {
  const data = validateRecord(input);
  const client = await pool.connect();
  let active = false;
  let releaseError;
  try {
    await client.query('BEGIN'); active = true;
    let playerId = null, guestId = data.guestId, player;
    if (data.dmpId) {
      const found = await client.query('SELECT id, dmp_id, handle_name FROM players WHERE dmp_id = $1 FOR KEY SHARE', [data.dmpId]);
      if (!found.rows.length) throw badRequest('プレイヤーが見つかりません。候補を選び直してください。');
      playerId = found.rows[0].id;
      player = {dmpId: found.rows[0].dmp_id, handleName: found.rows[0].handle_name};
    } else if (data.createGuest) {
      const created = await client.query('INSERT INTO rps_guests (handle_name) VALUES ($1) RETURNING id, handle_name', [data.playerName]);
      guestId = created.rows[0].id;
      player = {guestId, handleName: created.rows[0].handle_name};
    } else {
      const found = await client.query('SELECT id, handle_name FROM rps_guests WHERE id = $1 FOR KEY SHARE', [guestId]);
      if (!found.rows.length) throw badRequest('記録先が見つかりません。候補を選び直してください。');
      player = {guestId, handleName: found.rows[0].handle_name};
    }
    const saved = await client.query(`INSERT INTO rock_paper_scissors_records (player_id, guest_id, hand)
      VALUES ($1, $2, $3) RETURNING id, hand, created_at`, [playerId, guestId ?? null, data.hand]);
    await client.query('COMMIT'); active = false;
    return {record: saved.rows[0], player};
  } catch (error) {
    if (active) try { await client.query('ROLLBACK'); } catch (rollbackError) { releaseError = rollbackError; }
    throw error;
  } finally { client.release(releaseError); }
}
function installRpsRoutes(app, pool) {
  app.post('/api/rps/records', async (req, res) => {
    try { res.status(201).json({success: true, ...await saveRecord(pool, req.body)}); }
    catch (error) {
      if (!error.status) console.error('じゃんけん記録エラー:', error);
      res.status(error.status || 500).json({success: false, error: error.status ? error.message : 'じゃんけんデータを保存できませんでした。'});
    }
  });
  app.get('/api/rps/guests/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!/^\d+$/.test(req.params.id) || !Number.isSafeInteger(id) || id < 1 || id > 2147483647) return res.status(400).json({success: false, error: '記録先IDが不正です。'});
    try {
      const found = await pool.query('SELECT id, handle_name FROM rps_guests WHERE id = $1', [id]);
      if (!found.rows.length) return res.status(404).json({success: false, error: '記録先が見つかりません。'});
      res.json({success: true, player: {guestId: id, dmpId: null, handleName: found.rows[0].handle_name},
        history: [], historyCount: 0, deckSummary: [], recentDecks: [], topDecks: [],
        rpsSummary: await loadRpsSummary(pool, {guestId: id})});
    } catch (error) {
      console.error('じゃんけん傾向取得エラー:', error);
      res.status(500).json({success: false, error: 'じゃんけんデータを取得できませんでした。'});
    }
  });
}
module.exports = {HANDS, validateRecord, summarizeHands, loadRpsSummary, searchGuests, saveRecord, installRpsRoutes};
