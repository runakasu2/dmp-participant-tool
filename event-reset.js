const fail=(message,status=400)=>Object.assign(new Error(message),{status});
function installEventResetRoutes(app,pool) {
  app.post('/api/events/reset',async(req,res)=>{
    const {eventIds,confirmed}=req.body||{};
    if(confirmed!==true||!Array.isArray(eventIds)||!eventIds.length||eventIds.length>1000||
      eventIds.some(id=>!Number.isInteger(id)||id<=0||id>2147483647)||new Set(eventIds).size!==eventIds.length) {
      return res.status(400).json({success:false,error:'重複のない有効な大会IDを1〜1000件指定し、リセットを確認してください。'});
    }
    const ids=[...eventIds].sort((a,b)=>a-b);
    let client,active=false,releaseError;
    try {
      client=await pool.connect();await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');active=true;
      // History has no event FK. Serialize against the existing history write boundary.
      await client.query('LOCK TABLE deck_history IN SHARE ROW EXCLUSIVE MODE');
      const events=await client.query('SELECT id FROM events WHERE id=ANY($1::int[]) ORDER BY id FOR UPDATE',[ids]);
      if(events.rows.length!==ids.length) throw fail('対象大会が見つからないか、すでにリセットされています。一覧を更新してください。',409);
      await client.query('SELECT id FROM deck_memo_events WHERE event_record_id=ANY($1::int[]) ORDER BY id FOR UPDATE',[ids]);
      await client.query(`DELETE FROM deck_memo_archive_players p USING deck_memo_archives a
        WHERE p.archive_id=a.id AND a.event_record_id=ANY($1::int[])`,[ids]);
      await client.query('DELETE FROM deck_memo_archives WHERE event_record_id=ANY($1::int[])',[ids]);
      // Explicit children first, including legacy candidate data from the earlier TCG implementation.
      for(const table of ['deck_memos','deck_memo_roster','deck_memo_external_players','deck_memo_dmp_candidates']) {
        await client.query(`DELETE FROM ${table} p USING deck_memo_events m
          WHERE p.memo_event_id=m.id AND m.event_record_id=ANY($1::int[])`,[ids]);
      }
      await client.query('DELETE FROM deck_memo_events WHERE event_record_id=ANY($1::int[])',[ids]);
      await client.query('DELETE FROM event_deck_predictions WHERE event_record_id=ANY($1::int[])',[ids]);
      await client.query('DELETE FROM event_results WHERE event_record_id=ANY($1::int[])',[ids]);
      await client.query(`DELETE FROM deck_history h USING events e
        WHERE e.id=ANY($1::int[]) AND h.shop_id=e.shop_id AND h.event_id=e.event_id AND h.seq=e.seq`,[ids]);
      const deleted=await client.query('DELETE FROM events WHERE id=ANY($1::int[]) RETURNING id',[ids]);
      if(deleted.rows.length!==ids.length) throw fail('大会情報が変更されました。一覧を更新して再試行してください。',409);
      await client.query('COMMIT');active=false;
      res.json({success:true,deletedEventCount:deleted.rows.length});
    } catch(error) {
      if(active)try{await client.query('ROLLBACK');}catch(err){releaseError=err;console.error('大会リセットROLLBACKエラー:',err);}
      console.error('大会リセットエラー:',error);
      res.status(error.status||500).json({success:false,error:error.status?error.message:'大会のリセットに失敗しました。再試行してください。'});
    } finally {client?.release(releaseError);}
  });
}
module.exports={installEventResetRoutes};
