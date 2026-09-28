const {getDeckCatalog} = require('./deck-catalog');
const {createHash} = require('node:crypto');
const {beginHistoryTransaction, saveDeckHistory} = require('./deck-history-store');
const failure = (message, status=400) => Object.assign(new Error(message), {status});

function eventKey(body) {
  const {shopId, eventId, seq} = body || {};
  if (![shopId,eventId,seq].every(value => typeof value === 'string' && value.trim() && value.length <= 100)) {
    throw failure('ShopID、EventID、Seqを指定してください。');
  }
  return {shopId,eventId,seq};
}

function classify(row) {
  if (row.deck_id !== null && !row.memo_deck_name) throw failure('保存済みメモに存在しないデッキIDがあります。メモを確認してください。',409);
  if (!row.result_player_id) return 'absent';
  if (row.deck_id === null) return 'unselected';
  if (!row.history_id) return 'new';
  return row.canonical_deck_name === row.memo_deck_name ? 'same' : 'conflict';
}

async function buildImportPreview(db, key) {
  const result = await db.query(`
    SELECT a.id AS archive_id, a.updated_at AS archive_updated_at, a.event_name,
      e.id AS event_record_id, e.event_date::text AS event_date,
      m.dmp_id, m.handle_name AS memo_name, m.deck_id, m.updated_at AS memo_updated_at,
      d.name AS memo_deck_name, p.id AS player_id, p.handle_name,
      r.player_id AS result_player_id,
      h.id AS history_id, h.deck_name AS current_deck_name, h.created_at AS history_updated_at,
      COALESCE(canonical.name, h.deck_name) AS canonical_deck_name
    FROM events e
    JOIN deck_memo_archives a ON a.event_record_id = e.id
    LEFT JOIN deck_memo_archive_players m ON m.archive_id = a.id
    LEFT JOIN decks d ON d.id = m.deck_id
    LEFT JOIN players p ON p.dmp_id = m.dmp_id
    LEFT JOIN event_results r ON r.event_record_id = e.id AND r.player_id = p.id
    LEFT JOIN LATERAL (
      SELECT id, deck_name, created_at FROM deck_history
      WHERE player_id = p.id AND shop_id = e.shop_id AND event_id = e.event_id AND seq = e.seq
      ORDER BY created_at DESC NULLS LAST, id DESC LIMIT 1
    ) h ON TRUE
    LEFT JOIN LATERAL (
      SELECT master.name FROM decks master
      LEFT JOIN deck_aliases alias ON alias.deck_id = master.id
      WHERE LOWER(master.name) = LOWER(h.deck_name) OR LOWER(alias.alias) = LOWER(h.deck_name)
      ORDER BY CASE WHEN LOWER(master.name) = LOWER(h.deck_name) THEN 0 ELSE 1 END, master.id LIMIT 1
    ) canonical ON TRUE
    WHERE e.shop_id = $1 AND e.event_id = $2 AND e.seq = $3
    ORDER BY m.dmp_id
  `, [key.shopId,key.eventId,key.seq]);
  const counts = {new:0,same:0,conflict:0,unselected:0,absent:0};
  if (!result.rows.length) return {archive:null,counts,players:[],token:null};
  const first = result.rows[0];
  const players = result.rows.filter(row => row.dmp_id != null).map(row => {
    const category = classify(row); counts[category]++;
    return {dmpId:row.dmp_id,name:row.handle_name || row.memo_name,playerId:row.player_id,
      currentDeckName:row.current_deck_name,memoDeckName:row.memo_deck_name,deckId:row.deck_id,category};
  });
  const token = createHash('sha256').update(JSON.stringify({key,rows:result.rows})).digest('hex');
  return {archive:{id:first.archive_id,eventName:first.event_name,eventDate:first.event_date,
    participantCount:players.length,registeredCount:players.filter(p=>p.deckId!==null).length},counts,players,token};
}

function installImportRoutes(app, pool) {
  app.post('/api/deck-memo/import-preview', async(req,res)=>{
    try { res.json({success:true,...await buildImportPreview(pool,eventKey(req.body))}); }
    catch(err){console.error('メモ反映プレビューエラー:',err.message);res.status(err.status||500).json({success:false,error:err.status?err.message:'プレビューを取得できませんでした。'});}
  });
  app.post('/api/deck-memo/import', async(req,res)=>{
    let client,releaseError;
    try {
      const key=eventKey(req.body);
      const {archiveId,token,overwriteDmpIds=[]}=req.body;
      if(!Number.isInteger(archiveId)||archiveId<=0||typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token)||
        !Array.isArray(overwriteDmpIds)||overwriteDmpIds.some(id=>typeof id!=='string')||new Set(overwriteDmpIds).size!==overwriteDmpIds.length) {
        throw failure('プレビューを開き直してください。');
      }
      client=await pool.connect();
      await beginHistoryTransaction(client);
      const preview=await buildImportPreview(client,key);
      if(!preview.archive||preview.archive.id!==archiveId||preview.token!==token) {
        throw failure('プレビュー後にデータが変更されています。プレビューを開き直してください。',409);
      }
      const conflicts=new Set(preview.players.filter(p=>p.category==='conflict').map(p=>p.dmpId));
      if(overwriteDmpIds.some(id=>!conflicts.has(id))) throw failure('競合の選択が不正です。プレビューを開き直してください。',409);
      const overwrite=new Set(overwriteDmpIds);
      const changes=[];
      for(const player of preview.players) {
        if(player.category!=='new' && !(player.category==='conflict'&&overwrite.has(player.dmpId))) continue;
        // memoDeckName comes exclusively from the current deck master joined by deck_id.
        await saveDeckHistory(client,{...key,playerId:player.playerId,eventDate:preview.archive.eventDate,deckName:player.memoDeckName});
        changes.push({dmpId:player.dmpId,deckId:player.deckId,deckName:player.memoDeckName,category:player.category});
      }
      const masters = await getDeckCatalog(client, true);
      await client.query('COMMIT');
      res.json({success:true,decks:masters.rows,changes,insertedCount:changes.filter(p=>p.category==='new').length,
        updatedCount:changes.filter(p=>p.category==='conflict').length});
    } catch(err) {
      if(client){try{await client.query('ROLLBACK');}catch(rollbackError){releaseError=rollbackError;}}
      console.error('メモ反映エラー:',err.message);
      res.status(err.status||500).json({success:false,error:err.status?err.message:'反映できませんでした。プレビューを開き直して再試行してください。'});
    } finally {if(client)client.release(releaseError);}
  });
}
module.exports={eventKey,classify,buildImportPreview,installImportRoutes};
