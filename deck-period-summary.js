const {getDeckTrends}=require('./deck-trends');
const {parseEventFilters}=require('./event-filters');
function buildPeriodSummary(data){
  const decks=new Map();let totalParticipants=0,registeredDecks=0,unregistered=0;
  for(const event of data.events){
    totalParticipants+=event.participantCount;registeredDecks+=event.registeredDeckCount;unregistered+=event.unregisteredCount;
    for(const deck of event.decks){
      const key=deck.deckId==null?'name:'+deck.deckName:'id:'+deck.deckId;
      if(!decks.has(key))decks.set(key,{deckId:deck.deckId,deckName:deck.deckName,image_url:deck.image_url,count:0});
      decks.get(key).count+=deck.count;
    }
  }
  const percentage=count=>totalParticipants>0?count/totalParticipants*100:0;
  return {format:data.format,startDate:data.startDate,endDate:data.endDate,
    totalEvents:data.events.length+data.excludedEvents.length,includedEvents:data.events.length,missingEvents:data.excludedEvents.length,
    excludedEvents:data.excludedEvents,totalParticipants,registeredDecks,unregistered,registrationPercentage:percentage(registeredDecks),
    decks:Array.from(decks.values(),deck=>({...deck,percentage:percentage(deck.count)})).sort((a,b)=>b.count-a.count||a.deckName.localeCompare(b.deckName,'ja'))};
}
function installPeriodSummaryRoutes(app,db){
  app.get('/api/deck-period-summary',async(req,res)=>{
    try{parseEventFilters(req.query);}catch(error){return res.status(400).json({success:false,error:error.message});}
    try{res.json({success:true,...buildPeriodSummary(await getDeckTrends(db,req.query))});}
    catch(error){console.error('期間母数取得エラー:',error);res.status(500).json({success:false,error:'期間母数を取得できませんでした。'});}
  });
}
module.exports={buildPeriodSummary,installPeriodSummaryRoutes};
