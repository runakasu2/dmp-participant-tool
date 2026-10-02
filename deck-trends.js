const {parseEventFilters}=require('./event-filters');
const {loadEventDeckRows,buildEventDeckSummary}=require('./event-deck-summary');
async function getDeckTrends(db,query){
  const filters=parseEventFilters(query),params=[filters.format],conditions=['format=$1'];
  for(const [key,operator] of [['startDate','>='],['endDate','<=']])if(filters[key]){
    params.push(filters[key]);conditions.push('event_date'+operator+'$'+params.length+'::date');
  }
  const result=await db.query(`SELECT id,shop_id,event_id,seq,event_name,event_date::text AS event_date,participant_count
    FROM events WHERE ${conditions.join(' AND ')} ORDER BY event_date ASC NULLS LAST,id ASC`,params);
  const rows=await loadEventDeckRows(db,result.rows.map(e=>e.id)),byEvent=new Map();
  for(const row of rows){if(!byEvent.has(row.event_record_id))byEvent.set(row.event_record_id,[]);byEvent.get(row.event_record_id).push(row);}
  const events=[],excludedEvents=[];
  for(const event of result.rows){
    const summary=buildEventDeckSummary(event,byEvent.get(event.id)||[]);
    const info={eventRecordId:event.id,eventName:event.event_name,eventDate:event.event_date,shopId:event.shop_id,eventId:event.event_id,seq:event.seq};
    if(!summary.registeredCount||!summary.participantCount||!event.event_date){
      excludedEvents.push({...info,reason:!summary.registeredCount?'unentered':!summary.participantCount?'unknown_participant_count':'unknown_date'});continue;
    }
    events.push({...info,participantCount:summary.participantCount,registeredDeckCount:summary.registeredCount,
      registrationPercentage:summary.registeredCount/summary.participantCount*100,unregisteredCount:summary.unregisteredCount,
      decks:summary.decks.map(({deckId,deckName,count,image_url})=>({deckId,deckName,count,image_url,percentage:count/summary.participantCount*100}))});
  }
  return {...filters,events,excludedEvents};
}
function installDeckTrendRoutes(app,db){
  app.get('/api/deck-trends',async(req,res)=>{
    try{parseEventFilters(req.query);}catch(error){return res.status(400).json({success:false,error:error.message});}
    try{res.json({success:true,...await getDeckTrends(db,req.query)});}
    catch(error){console.error('デッキ母数推移取得エラー:',error);res.status(500).json({success:false,error:'デッキ母数推移を取得できませんでした。'});}
  });
}
module.exports={getDeckTrends,installDeckTrendRoutes};
