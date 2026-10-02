// Shared by individual event summaries and cross-event trends. Preserve the
// existing participant_count denominator and history-record counting semantics.
async function loadEventDeckRows(db, eventIds) {
  if (!eventIds.length) return [];
  const result = await db.query(`
    SELECT e.id AS event_record_id, COALESCE(master.name,dh.deck_name) AS deck_name,
      master.id AS deck_id,master.image_url,p.dmp_id,p.handle_name
    FROM events e
    JOIN deck_history dh ON dh.shop_id=e.shop_id AND dh.event_id=e.event_id AND dh.seq=e.seq
    JOIN players p ON p.id=dh.player_id
    LEFT JOIN LATERAL (
      SELECT d.id,d.name,d.image_url FROM decks d
      WHERE LOWER(d.name)=LOWER(dh.deck_name) OR EXISTS (
        SELECT 1 FROM deck_aliases a WHERE a.deck_id=d.id AND LOWER(a.alias)=LOWER(dh.deck_name))
      ORDER BY CASE WHEN LOWER(d.name)=LOWER(dh.deck_name) THEN 0 ELSE 1 END,d.id LIMIT 1
    ) master ON true
    WHERE e.id=ANY($1::int[])
    ORDER BY e.id,deck_name,p.handle_name,p.id
  `,[eventIds]);
  return result.rows;
}
function buildEventDeckSummary(event, rows) {
  const map=new Map();
  for(const row of rows){
    const key=row.deck_id == null ? 'name:'+row.deck_name : 'id:'+row.deck_id;
    if(!map.has(key))map.set(key,{deckName:row.deck_name,deckId:row.deck_id,image_url:row.image_url,count:0,players:[]});
    const deck=map.get(key);deck.count++;deck.players.push({dmpId:row.dmp_id,handleName:row.handle_name});
  }
  const participantCount=Number(event.participant_count)||0,registeredCount=rows.length;
  const decks=Array.from(map.values(),deck=>({...deck,percentage:participantCount>0?(deck.count/participantCount*100).toFixed(1):'0.0'}))
    .sort((a,b)=>b.count-a.count||a.deckName.localeCompare(b.deckName,'ja'));
  return {participantCount,registeredCount,unregisteredCount:Math.max(0,participantCount-registeredCount),decks};
}
module.exports={loadEventDeckRows,buildEventDeckSummary};
