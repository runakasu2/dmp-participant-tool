const fail=message=>Object.assign(new Error(message),{status:400});
const identity=(p,provider)=>provider==='tcg_meister'||!p.dmpId ? (p.participantKey?'key:'+p.participantKey:null) : 'dmp:'+p.dmpId;
function pairFor(players,player,provider){
 const pair=players.filter(p=>p.table!=null&&String(p.table)===String(player.table));
 if(pair.length!==2||pair.some(p=>p.bye||!identity(p,provider)))return null;
 const keys=pair.map(p=>identity(p,provider)).sort();
 if(keys[0]===keys[1]||keys.some(k=>players.filter(p=>identity(p,provider)===k).length!==1))return null;
 return keys;
}
function choices(draft,key){
 const other=draft.pair.find(k=>k!==key),used=draft.resolved[other];
 const values=[...draft.decks];if(used!=null){const i=values.indexOf(used);if(i>=0)values.splice(i,1);}
 return [...new Set(values)];
}
function installDraftRoutes(app,pool){
 app.get('/api/deck-memo/table-drafts',async(req,res)=>{try{
 const id=Number(req.query.memoEventId);if(!Number.isSafeInteger(id)||id<=0)throw fail('大会IDが不正です。');
 const result=await pool.query('SELECT * FROM deck_memo_table_drafts WHERE memo_event_id=$1 ORDER BY round,id',[id]);
 res.set('Cache-Control','no-store');res.json({success:true,drafts:result.rows});
 }catch(e){res.status(e.status||500).json({success:false,error:e.status?e.message:'仮登録を取得できませんでした。'});}});
 app.post('/api/deck-memo/table-drafts',async(req,res)=>{
 let db,active=false;try{
 const b=req.body||{},source=require('./deck-memo').detectProvider(b.url);
 if(!Number.isInteger(b.memoEventId)||b.memoEventId<=0)throw fail('大会IDが不正です。');
 db=await pool.connect();await db.query('BEGIN');active=true;
 // Match confirmed memo/merge lock order: decks before the provider event.
 const lockDecks=b.action==='create'?b.decks:b.action==='confirm'?[b.deckId]:[];
 if(!Array.isArray(lockDecks)||lockDecks.length>2||lockDecks.some(id=>!Number.isInteger(id)||id<=0))throw fail('デッキ候補の指定が不正です。');
 for(const id of [...new Set(lockDecks)].sort((a,b)=>a-b))if(!(await db.query('SELECT id FROM decks WHERE id=$1 FOR KEY SHARE',[id])).rows.length)throw fail('デッキが見つかりません。');
 const event=(await db.query('SELECT id FROM deck_memo_events WHERE id=$1 AND source=$2 AND admin_key=$3 FOR UPDATE',[b.memoEventId,source.provider,source.adminKey||source.tid])).rows[0];
 if(!event)throw fail('大会が見つかりません。');
 let draft;
 if(b.action==='create'){
 if(!Number.isInteger(b.round)||b.round<=0||!Array.isArray(b.players)||b.players.length!==2||b.players.some(p=>String(p.table)!==String(b.table))||String(b.table).length>100)throw fail('卓の指定が不正です。');
 const pair=pairFor(b.players,b.players[0],source.provider);
 if(!pair||!Array.isArray(b.decks)||b.decks.length!==2||b.decks.some(id=>!Number.isInteger(id)||id<=0))throw fail('2人と2件のデッキを選択してください。');
 for(const key of pair){
 const external=key.startsWith('key:');
 const found=await db.query(external?'SELECT 1 FROM deck_memo_external_players WHERE memo_event_id=$1 AND participant_key=$2':'SELECT 1 FROM deck_memo_roster WHERE memo_event_id=$1 AND dmp_id=$2',[b.memoEventId,key.slice(4)]);
 // Unlinked Nojigiku drafts have no roster; require a memo identity already saved there.
 if(!found.rows.length){const memo=!external&&await db.query('SELECT 1 FROM deck_memos WHERE memo_event_id=$1 AND dmp_id=$2',[b.memoEventId,key.slice(4)]);if(!memo?.rows.length)throw fail('参加者情報を保存できていません。DMP大会URLを指定して再取得してください。');}
 }
 for(const id of b.decks)if(!(await db.query('SELECT id FROM decks WHERE id=$1 FOR KEY SHARE',[id])).rows.length)throw fail('デッキが見つかりません。');
 draft=(await db.query(`INSERT INTO deck_memo_table_drafts(memo_event_id,round,table_no,pair,decks) VALUES($1,$2,$3,$4,$5)
 ON CONFLICT(memo_event_id,round,table_no,pair) DO UPDATE SET decks=deck_memo_table_drafts.decks RETURNING *`,[b.memoEventId,b.round,String(b.table),pair,b.decks])).rows[0];
 }else{
 draft=(await db.query('SELECT * FROM deck_memo_table_drafts WHERE memo_event_id=$1 AND id=$2 FOR UPDATE',[b.memoEventId,b.id])).rows[0];
 if(!draft)throw fail('仮登録がありません。再取得してください。');
 if(b.action==='cancel')await db.query('DELETE FROM deck_memo_table_drafts WHERE id=$1',[draft.id]);
 else if(b.action==='confirm'){
 if(!draft.pair.includes(b.key)||!choices(draft,b.key).includes(b.deckId)||draft.resolved[b.key]!=null)throw fail('候補が変更されています。再取得してください。');
 const deck=(await db.query('SELECT id,name FROM decks WHERE id=$1 FOR KEY SHARE',[b.deckId])).rows[0];if(!deck)throw fail('デッキが見つかりません。');
 // Same participant keys and storage as the normal memo write routes; never write the partner.
 if(b.key.startsWith('key:')){
 const result=await require('./memo-write').writeExternalMemo(db,b.memoEventId,b.key.slice(4),b.deckId);if(!result.rows.length)throw fail('参加者がありません。');
 }else await require('./memo-write').writeDmpMemo(db,b.memoEventId,b.key.slice(4),b.deckId);
 draft.resolved[b.key]=b.deckId;
 await db.query('UPDATE deck_memo_table_drafts SET resolved=$2 WHERE id=$1',[draft.id,JSON.stringify(draft.resolved)]);
 }else throw fail('操作が不正です。');
 }
 await db.query('COMMIT');active=false;res.json({success:true,draft});
 }catch(e){if(active)await db.query('ROLLBACK').catch(()=>{});res.status(e.status||500).json({success:false,error:e.status?e.message:'仮登録を保存できませんでした。'});}finally{db?.release();}
 });
}
if(typeof module!=='undefined')module.exports={identity,pairFor,choices,installDraftRoutes};
