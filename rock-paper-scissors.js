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
  if (Object.hasOwn(body, 'ties') && (!Array.isArray(body.ties) || Array.from(body.ties).some(hand => !HANDS.includes(hand)))) throw badRequest('あいこの手を選択するか、不要な入力欄を削除してください。');
  return {playerName, hand: body.hand, dmpId, guestId, createGuest, ...(Object.hasOwn(body, 'ties') ? {ties: [...body.ties]} : {})};
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
    await writeTies(client, saved.rows[0].id, data.ties || []);
    await client.query('COMMIT'); active = false;
    return {record: {...saved.rows[0], ties: data.ties || []}, player};
  } catch (error) {
    if (active) try { await client.query('ROLLBACK'); } catch (rollbackError) { releaseError = rollbackError; }
    throw error;
  } finally { client.release(releaseError); }
}

function summarizeTieTransitions(rows) {
  return {stages: [1, 2, 3].map(stage => {
    const summary = summarizeHands(rows.filter(row => Number(row.stage) === stage));
    const max = Math.max(...summary.hands.map(hand => hand.count));
    return {afterTies: stage, nextRound: stage + 1, samples: summary.total, hands: summary.hands,
      predictedHands: max ? summary.hands.filter(hand => hand.count === max).map(hand => hand.hand) : []};
  })};
}
async function loadTiePredictions(db, {playerId, guestId}) {
  const column = playerId != null ? 'player_id' : 'guest_id';
  const result = await db.query(`WITH transitions AS (
    SELECT t.position AS stage, COALESCE(LEAD(t.hand) OVER (PARTITION BY r.id ORDER BY t.position), r.hand) AS hand
    FROM rock_paper_scissors_records r JOIN rps_record_ties t ON t.record_id=r.id WHERE r.${column}=$1
  ) SELECT stage,hand,COUNT(*)::int AS count FROM transitions WHERE stage<=3 GROUP BY stage,hand`, [playerId ?? guestId]);
  return summarizeTieTransitions(result.rows);
}
async function writeTies(db, recordId, ties) {
  if (ties.length) await db.query(`INSERT INTO rps_record_ties(record_id,position,hand)
    SELECT $1,position::int,hand FROM unnest($2::text[]) WITH ORDINALITY AS t(hand,position)`, [recordId, ties]);
}
function validRecordId(value) { return /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value)>0 && Number(value)<=2147483647; }
async function resolveOwner(db, input) {
  const data = input.dmpId ? await db.query('SELECT id,dmp_id,handle_name FROM players WHERE dmp_id=$1', [input.dmpId])
    : await db.query('SELECT id,handle_name FROM rps_guests WHERE id=$1', [input.guestId]);
  if (!data.rows.length) throw Object.assign(new Error('記録先が見つかりません。'), {status:404});
  const row=data.rows[0];
  return {column:input.dmpId?'player_id':'guest_id', id:row.id,
    player:input.dmpId?{dmpId:row.dmp_id,handleName:row.handle_name}:{guestId:row.id,handleName:row.handle_name}};
}
async function editRecord(pool, id, input) {
  if (!validRecordId(id)) throw badRequest('記録IDが不正です。');
  const data=validateRecord(input);if(data.createGuest)throw badRequest('既存の記録先を選択してください。');
  const client=await pool.connect();let active=false,releaseError;
  try {
    await client.query('BEGIN');active=true;
    const owner=await resolveOwner(client,data);
    const saved=await client.query(`UPDATE rock_paper_scissors_records SET hand=$1 WHERE id=$2 AND ${owner.column}=$3 RETURNING id,hand,created_at`,[data.hand,Number(id),owner.id]);
    if(!saved.rows.length)throw Object.assign(new Error('このプレイヤーの記録が見つかりません。'),{status:404});
    if(Object.hasOwn(data,'ties')){await client.query('DELETE FROM rps_record_ties WHERE record_id=$1',[Number(id)]);await writeTies(client,Number(id),data.ties);}
    const ties=await client.query('SELECT hand FROM rps_record_ties WHERE record_id=$1 ORDER BY position',[Number(id)]);
    await client.query('COMMIT');active=false;
    return {record:{...saved.rows[0],ties:ties.rows.map(row=>row.hand)},player:owner.player};
  } catch(error){if(active)try{await client.query('ROLLBACK');}catch(e){releaseError=e;}throw error;}
  finally{client.release(releaseError);}
}

function installRpsRoutes(app, pool) {
  app.post('/api/rps/records', async (req, res) => {
    try { res.status(201).json({success: true, ...await saveRecord(pool, req.body)}); }
    catch (error) {
      if (!error.status) console.error('じゃんけん記録エラー:', error);
      res.status(error.status || 500).json({success: false, error: error.status ? error.message : 'じゃんけんデータを保存できませんでした。'});
    }
  });
  app.put('/api/rps/records/:id', async (req,res)=> {
    try{res.json({success:true,...await editRecord(pool,req.params.id,req.body)});}
    catch(error){res.status(error.status||500).json({success:false,error:error.status?error.message:'記録を更新できませんでした。保存内容は保持しています。'});}
  });
  app.get('/api/rps/records',async(req,res)=>{
    let client,active=false,releaseError;
    try{
      const query=req.query||{},dmpId=typeof query.dmpId==='string'?query.dmpId.trim():'';
      if((query.dmpId!=null&&(!dmpId||dmpId.length>50))||Number(Boolean(dmpId))+Number(query.guestId!=null)!==1||(query.guestId!=null&&(typeof query.guestId!=='string'||!validRecordId(query.guestId))))throw badRequest('記録先を指定してください。');
      const page=query.page||'1';if(typeof page!=='string'||!validRecordId(page))throw badRequest('ページが不正です。');
      client=await pool.connect();await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');active=true;
      const owner=await resolveOwner(client,{dmpId,guestId:Number(query.guestId)});
      const count=await client.query(`SELECT COUNT(*)::int AS total FROM rock_paper_scissors_records WHERE ${owner.column}=$1`,[owner.id]);
      const rows=await client.query(`SELECT r.id,r.hand,r.created_at,COALESCE((SELECT array_agg(t.hand ORDER BY t.position) FROM rps_record_ties t WHERE t.record_id=r.id),'{}') AS ties
        FROM rock_paper_scissors_records r WHERE r.${owner.column}=$1 ORDER BY r.created_at DESC,r.id DESC LIMIT 30 OFFSET $2`,[owner.id,(Number(page)-1)*30]);
      await client.query('COMMIT');active=false;res.json({success:true,player:owner.player,records:rows.rows,total:count.rows[0].total,page:Number(page),pageSize:30});
    }catch(error){if(active)try{await client.query('ROLLBACK');}catch(e){releaseError=e;}res.status(error.status||500).json({success:false,error:error.status?error.message:'記録一覧を取得できませんでした。'});}
    finally{client?.release(releaseError);}
  });
  app.get('/api/rps/guests/:id' , async (req, res) => {
    const id = Number(req.params.id);
    if (!/^\d+$/.test(req.params.id) || !Number.isSafeInteger(id) || id < 1 || id > 2147483647) return res.status(400).json({success: false, error: '記録先IDが不正です。'});
    try {
      const found = await pool.query('SELECT id, handle_name FROM rps_guests WHERE id = $1', [id]);
      if (!found.rows.length) return res.status(404).json({success: false, error: '記録先が見つかりません。'});
      res.json({success: true, player: {guestId: id, dmpId: null, handleName: found.rows[0].handle_name},
        history: [], historyCount: 0, deckSummary: [], recentDecks: [], topDecks: [],
        rpsTiePredictions: await loadTiePredictions(pool, {guestId: id}),
        rpsSummary: await loadRpsSummary(pool, {guestId: id})});
    } catch (error) {
      console.error('じゃんけん傾向取得エラー:', error);
      res.status(500).json({success: false, error: 'じゃんけんデータを取得できませんでした。'});
    }
  });
}
module.exports = {HANDS, validateRecord, summarizeHands, loadRpsSummary, searchGuests, saveRecord, installRpsRoutes, summarizeTieTransitions, loadTiePredictions, editRecord};
