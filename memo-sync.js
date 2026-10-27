// Process-local invalidation. No timers query PostgreSQL; heartbeat writes comments only.
function installMemoSync(app, pool) {
  const channels = new Map();
  async function snapshot(id) {
    const event = (await pool.query('SELECT id,event_record_id FROM deck_memo_events WHERE id=$1', [id])).rows[0];
    if (!event) return {success:true,deleted:true,players:[]};
    // External rows with verified DMP IDs are roster metadata, except for TCG's key-based memos.
    const result = await pool.query(`SELECT m.dmp_id, NULL::text AS participant_key,m.deck_id,d.name AS deck_name
      FROM deck_memos m LEFT JOIN decks d ON d.id=m.deck_id WHERE m.memo_event_id=$1
      UNION ALL SELECT p.dmp_id,p.participant_key,p.deck_id,d.name AS deck_name
      FROM deck_memo_external_players p LEFT JOIN decks d ON d.id=p.deck_id WHERE p.memo_event_id=$1
        AND (p.dmp_id IS NULL OR EXISTS (SELECT 1 FROM deck_memo_events e WHERE e.id=p.memo_event_id AND e.source='tcg_meister'))
      ORDER BY participant_key NULLS FIRST,dmp_id`, [id]);
    return {success:true,players:result.rows};
  }
  app.get('/api/deck-memo/state', async(req,res)=>{
    const id=Number(req.query.memoEventId);
    if(!Number.isInteger(id)||id<=0)return res.status(400).json({success:false,error:'大会IDが不正です。'});
    try {res.set('Cache-Control','no-store');res.json(await snapshot(id));}
    catch {res.status(500).json({success:false,error:'メモを更新できませんでした。'});}
  });
  app.get('/api/deck-memo/events',async(req,res)=>{
    const id=Number(req.query.memoEventId);
    if(!Number.isInteger(id)||id<=0)return res.status(400).end();
    try {
      const event=(await pool.query(`SELECT m.id, e.shop_id,e.event_id,e.seq FROM deck_memo_events m
        LEFT JOIN events e ON e.id=m.event_record_id WHERE m.id=$1`,[id])).rows[0];
      if(!event)return res.status(404).end();
      // DMP event key is authoritative; unlinked drafts stay provider/memo scoped.
      const key=event.shop_id!=null?JSON.stringify([event.shop_id,event.event_id,event.seq]):'draft:'+id;
      const initial=JSON.stringify(await snapshot(id));
      if(req.destroyed)return;
      res.set({'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
      res.flushHeaders();res.write('retry: 3000\nevent: ready\ndata: {}\n\n');
      const connection={id,key,res,state:initial,chain:Promise.resolve()};channels.set(res,connection);
      const timer=setInterval(()=>{if(!res.write(': heartbeat\n\n'))res.destroy();},20000);timer.unref?.();
      res.on('close',()=>{clearInterval(timer);channels.delete(res);});
    } catch {if(!res.headersSent)res.status(500).end();else res.end();}
  });
  // Batch bursts and share each snapshot across all viewers of a memo event.
  let timer=null, origin=null, checking=Promise.resolve();
  function schedule(client){
    origin=timer===null?client:(origin===client?origin:null);
    if(timer!==null)return;
    timer=setTimeout(()=>{
      timer=null;const source=origin;
      checking=checking.then(async()=>{
        const groups=new Map();
        for(const connection of channels.values()){
          if(!groups.has(connection.id))groups.set(connection.id,[]);
          groups.get(connection.id).push(connection);
        }
        for(const [id,connections] of groups){
          try{
            const state=JSON.stringify(await snapshot(id));
            for(const connection of connections){
              if(!channels.has(connection.res)||state===connection.state)continue;
              connection.state=state;
              if(!connection.res.write('event: change\ndata: '+JSON.stringify({origin:source,players:JSON.parse(state).players})+'\n\n'))connection.res.destroy();
            }
          }catch{for(const connection of connections)connection.res.end();}
        }
      }).catch(()=>{});
    },100);
    timer.unref?.();
  }
  // Successful API mutations include imports, resets and catalog merges. Compare persisted
  // snapshots before notifying, so unrelated tournaments never receive change events.
  app.use((req,res,next)=>{
    if(!['POST','PUT','PATCH','DELETE'].includes(req.method)||!req.path.startsWith('/api/'))return next();
    const json=res.json;
    res.json=function(body){
      if(body?.success && res.statusCode<400 && channels.size)schedule(req.get('X-Memo-Client')||null);
      return json.call(this,body);
    };next();
  });
}
module.exports={installMemoSync};
