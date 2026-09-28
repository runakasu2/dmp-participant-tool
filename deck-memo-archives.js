const validId = id => /^[1-9]\d*$/.test(String(id)) && Number(id) <= 2147483647;
const error = (message, status) => Object.assign(new Error(message), {status});

function installArchiveRoutes(app, pool) {
  app.post('/api/deck-memo/archives', async (req, res) => {
    const memoEventId = req.body?.memoEventId;
    if (!Number.isInteger(memoEventId) || !validId(memoEventId)) {
      return res.status(400).json({success:false,error:'大会情報・対戦表を取得してから保存してください。'});
    }
    let client, active = false, releaseError;
    try {
      client = await pool.connect();
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ'); active = true;
      const event = await client.query(`
        SELECT m.id, m.admin_key, m.source_url, e.id AS event_record_id,
          e.event_name, e.event_date::text AS event_date
        FROM deck_memo_events m JOIN events e ON e.id = m.event_record_id
        WHERE m.id = $1
      `, [memoEventId]);
      if (!event.rows.length) throw error('DMP大会に紐付いたメモが見つかりません。再取得してください。',404);
      const info = event.rows[0];
      if (!info.event_name || !info.event_date) throw error('大会名・開催日を取得し直してください。',400);
      const roster = await client.query(`
        SELECT r.dmp_id, r.handle_name, r.entry_no, r.table_no, r.round,
          p.id AS player_id, m.deck_id
        FROM deck_memo_roster r
        LEFT JOIN players p ON p.dmp_id = r.dmp_id
        LEFT JOIN deck_memos m ON m.memo_event_id = r.memo_event_id AND m.dmp_id = r.dmp_id
        WHERE r.memo_event_id = $1
      `, [memoEventId]);
      if (!roster.rows.length) throw error('保存できる参加者がいません。保存済み大会は変更していません。',400);
      const deckIds = [...new Set(roster.rows.map(p => p.deck_id).filter(id => id !== null))].sort((a,b)=>a-b);
      // Merge locks decks before updating archive rows. Use the same order.
      if (deckIds.length) await client.query('SELECT id FROM decks WHERE id = ANY($1::int[]) ORDER BY id FOR KEY SHARE', [deckIds]);
      const archive = await client.query(`
        INSERT INTO deck_memo_archives (event_record_id, event_name, event_date, admin_key, source_url)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (event_record_id) DO UPDATE SET
          event_name = EXCLUDED.event_name, event_date = EXCLUDED.event_date,
          admin_key = EXCLUDED.admin_key, source_url = EXCLUDED.source_url, updated_at = CURRENT_TIMESTAMP
        RETURNING id
      `, [info.event_record_id, info.event_name, info.event_date, info.admin_key, info.source_url]);
      const archiveId = archive.rows[0].id;
      // Absent/dropped players remain. Explicitly unselected decks become NULL.
      await client.query(`
        INSERT INTO deck_memo_archive_players
          (archive_id, dmp_id, player_id, handle_name, entry_no, table_no, round, deck_id)
        SELECT $1::integer, x.dmp_id, x.player_id, x.handle_name, x.entry_no, x.table_no, x.round, x.deck_id
        FROM jsonb_to_recordset($2::jsonb) AS x(dmp_id varchar(50), player_id integer,
          handle_name text, entry_no text, table_no integer, round integer, deck_id integer)
        ON CONFLICT (archive_id, dmp_id) DO UPDATE SET
          player_id = EXCLUDED.player_id, handle_name = EXCLUDED.handle_name,
          entry_no = EXCLUDED.entry_no, table_no = EXCLUDED.table_no, round = EXCLUDED.round,
          deck_id = EXCLUDED.deck_id, updated_at = CURRENT_TIMESTAMP
      `, [archiveId, JSON.stringify(roster.rows)]);
      await client.query('COMMIT'); active = false;
      res.json({success:true,archiveId});
    } catch (err) {
      if (active) { try { await client.query('ROLLBACK'); } catch (rollbackError) { releaseError = rollbackError; } }
      console.error('大会デッキメモ保存エラー:',err.message);
      res.status(err.status || 500).json({success:false,error:err.status?err.message:'大会デッキメモを保存できませんでした。再試行してください。'});
    } finally { if(client) client.release(releaseError); }
  });

  app.post('/api/deck-memo/archives/:id/reset', async (req, res) => {
    if (!validId(req.params.id) || req.body?.confirmed !== true || typeof req.body?.eventName !== 'string') {
      return res.status(400).json({success:false,error:'大会を確認してからリセットしてください。'});
    }
    let client, active = false, releaseError;
    try {
      client = await pool.connect();
      await client.query('BEGIN'); active = true;
      const found = await client.query('SELECT id, event_record_id, event_name FROM deck_memo_archives WHERE id = $1 FOR UPDATE', [Number(req.params.id)]);
      if (!found.rows.length) throw error('保存済み大会が見つかりません。',404);
      const archive = found.rows[0];
      if (archive.event_name !== req.body.eventName) throw error('大会情報が変更されています。開き直して確認してください。',409);
      const drafts = await client.query('SELECT id FROM deck_memo_events WHERE event_record_id = $1 ORDER BY id FOR UPDATE', [archive.event_record_id]);
      const memoEventIds = drafts.rows.map(row => row.id);
      await client.query('DELETE FROM deck_memo_archive_players WHERE archive_id = $1', [archive.id]);
      await client.query('DELETE FROM deck_memo_archives WHERE id = $1', [archive.id]);
      if (memoEventIds.length) {
        await client.query('DELETE FROM deck_memos WHERE memo_event_id = ANY($1::int[])', [memoEventIds]);
        await client.query('DELETE FROM deck_memo_roster WHERE memo_event_id = ANY($1::int[])', [memoEventIds]);
        await client.query('DELETE FROM deck_memo_events WHERE id = ANY($1::int[])', [memoEventIds]);
      }
      await client.query('COMMIT'); active = false;
      res.json({success:true,memoEventIds});
    } catch (err) {
      if (active) { try { await client.query('ROLLBACK'); } catch (rollbackError) { releaseError = rollbackError; } }
      console.error('大会メモリセットエラー:',err.message);
      res.status(err.status || 500).json({success:false,error:err.status?err.message:'リセットできませんでした。再試行してください。'});
    } finally { if(client) client.release(releaseError); }
  });

  app.get('/api/deck-memo/archives', async (req,res) => {
    try {
      const result = await pool.query(`
        SELECT a.id, a.event_name, a.event_date::text AS event_date, a.admin_key,
          a.created_at, a.updated_at,
          COUNT(p.dmp_id)::int AS participant_count, COUNT(p.deck_id)::int AS registered_count
        FROM deck_memo_archives a
        LEFT JOIN deck_memo_archive_players p ON p.archive_id = a.id
        GROUP BY a.id ORDER BY a.event_date DESC, a.id DESC
      `);
      res.json({success:true,events:result.rows});
    } catch(err) {
      console.error('保存済みメモ一覧エラー:',err.message);
      res.status(500).json({success:false,error:'保存済みデッキメモ一覧を取得できませんでした。'});
    }
  });

  app.get('/api/deck-memo/archives/:id', async (req,res) => {
    if(!validId(req.params.id)) return res.status(400).json({success:false,error:'保存済み大会IDが不正です。'});
    try {
      // One DB statement keeps metadata and participants on the same snapshot.
      const result = await pool.query(`
        SELECT a.*, a.event_date::text AS saved_date, e.shop_id, e.event_id, e.seq,
          p.dmp_id, p.handle_name, p.entry_no, p.table_no, p.round, p.deck_id, d.name AS deck_name
        FROM deck_memo_archives a JOIN events e ON e.id = a.event_record_id
        LEFT JOIN deck_memo_archive_players p ON p.archive_id = a.id
        LEFT JOIN decks d ON d.id = p.deck_id
        WHERE a.id = $1
        ORDER BY p.table_no ASC NULLS LAST, p.dmp_id
      `,[Number(req.params.id)]);
      if(!result.rows.length) return res.status(404).json({success:false,error:'保存済み大会が見つかりません。'});
      const a=result.rows[0];
      const participants=result.rows.filter(p=>p.dmp_id != null).map(p=>({dmpId:p.dmp_id,name:p.handle_name,
        entryNo:p.entry_no,table:p.table_no,round:p.round,deckId:p.deck_id,deckName:p.deck_name}));
      res.json({success:true,event:{id:a.id,shopId:a.shop_id,eventId:a.event_id,seq:a.seq,
        eventName:a.event_name,eventDate:a.saved_date,adminKey:a.admin_key,sourceUrl:a.source_url,
        createdAt:a.created_at,updatedAt:a.updated_at},participants,
        participantCount:participants.length,registeredCount:participants.filter(p=>p.deckId!==null).length});
    } catch(err) {
      console.error('保存済みメモ詳細エラー:',err.message);
      res.status(500).json({success:false,error:'保存済みデッキメモを取得できませんでした。'});
    }
  });
}
module.exports={installArchiveRoutes};
