// One database query for the entire catalogue, including tied ranks.
const EVENT_CATALOG_SQL = `
SELECT e.*, COALESCE(r.result_count,0)::int AS result_count,
 COALESCE(b.best_four,'[]'::jsonb) AS best_four
FROM events e
LEFT JOIN (SELECT event_record_id, COUNT(*) AS result_count FROM event_results GROUP BY event_record_id) r
 ON r.event_record_id=e.id
LEFT JOIN (
 SELECT er.event_record_id, jsonb_agg(jsonb_build_object(
 'rank',er.rank,'dmpId',p.dmp_id,'handleName',p.handle_name,'deckName',COALESCE(master.name,dh.deck_name),'deckId',master.id,'deckImageUrl',master.image_url)
 ORDER BY er.rank,p.dmp_id,p.id) AS best_four
 FROM event_results er
 JOIN events ev ON ev.id=er.event_record_id
 JOIN players p ON p.id=er.player_id
 LEFT JOIN LATERAL (
   SELECT h.deck_name FROM deck_history h
   WHERE h.player_id=er.player_id AND h.shop_id=ev.shop_id AND h.event_id=ev.event_id AND h.seq=ev.seq
   ORDER BY h.created_at DESC NULLS LAST,h.id DESC LIMIT 1
 ) dh ON true
 LEFT JOIN LATERAL (
   SELECT d.id,d.name,d.image_url FROM decks d
   WHERE LOWER(d.name)=LOWER(dh.deck_name) OR EXISTS (
     SELECT 1 FROM deck_aliases a WHERE a.deck_id=d.id AND LOWER(a.alias)=LOWER(dh.deck_name))
   ORDER BY CASE WHEN LOWER(d.name)=LOWER(dh.deck_name) THEN 0 ELSE 1 END,d.id LIMIT 1
 ) master ON true
 WHERE er.rank <= 4
 GROUP BY er.event_record_id
) b ON b.event_record_id=e.id
ORDER BY e.event_date DESC NULLS LAST,e.id DESC`;
function filteredEventCatalog(query={}){
 const {parseEventFilters}=require('./event-filters');
 let filters;try{filters=parseEventFilters(query);}catch(error){error.status=400;throw error;}
 const clauses=[],params=[];
 // Keep unfiltered API access compatible; the UI always sends its chosen format.
 if(query.format!==undefined){params.push(filters.format);clauses.push('format=$'+params.length);}
 for(const [key,operator] of [['startDate','>='],['endDate','<=']])if(filters[key]){params.push(filters[key]);clauses.push('event_date'+operator+'$'+params.length+'::date');}
 const cte='WITH selected_events AS (SELECT * FROM events'+(clauses.length?' WHERE '+clauses.join(' AND '):'')+') ';
 return {sql:cte+EVENT_CATALOG_SQL.replace('FROM events e','FROM selected_events e').replace('JOIN events ev','JOIN selected_events ev'),params};
}
function parseImageUrl(value) {
  if (value === '' || value === null) return null;
  if (typeof value !== 'string' || value.length > 2048) throw Error('画像のHTTPS URLを入力してください。');
  let url; try { url=new URL(value); } catch { throw Error('画像のHTTPS URLを入力してください。'); }
  if(url.protocol!=='https:'||url.username||url.password) throw Error('画像のHTTPS URLを入力してください。');
  return url.href;
}
function installDeckImageRoute(app,pool) {
  app.put('/api/decks/:id/image',async(req,res)=>{
    const id=Number(req.params.id);let imageUrl;
    if(!Number.isInteger(id)||id<1||id>2147483647)return res.status(400).json({success:false,error:'デッキIDが不正です。'});
    try {imageUrl=parseImageUrl(req.body?.imageUrl);} catch(error){return res.status(400).json({success:false,error:error.message});}
    try {
      const result=await pool.query('UPDATE decks SET image_url=$2,updated_at=CURRENT_TIMESTAMP WHERE id=$1 RETURNING id,image_url',[id,imageUrl]);
      if(!result.rows.length)return res.status(404).json({success:false,error:'デッキが見つかりません。'});
      res.json({success:true,deck:result.rows[0]});
    } catch(error){console.error('デッキ画像保存エラー:',error);res.status(500).json({success:false,error:'画像URLを保存できませんでした。'});}
  });
}
module.exports={filteredEventCatalog,EVENT_CATALOG_SQL,parseImageUrl,installDeckImageRoute};
