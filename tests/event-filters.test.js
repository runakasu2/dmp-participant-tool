const {test}=require('node:test'),assert=require('node:assert/strict');
const {parseEventFilters,eventFilterQuery}=require('../event-filters');
const {filteredEventCatalog}=require('../event-catalog');
test('default/invalid format and URL round trip with date preservation',()=>{
 assert.equal(parseEventFilters().format,'original');assert.equal(parseEventFilters({format:'bad'}).format,'original');
 for(const format of ['original','advance','2block']){
 const state=parseEventFilters({format,startDate:'2026-09-01',endDate:'2026-09-30'});
 assert.deepEqual(parseEventFilters(Object.fromEntries(new URLSearchParams(eventFilterQuery(state)))),state);
 assert.equal(parseEventFilters({...state,format:'advance'}).startDate,state.startDate);
 }
});
test('period boundaries validate dates and refuse inverted ranges',()=>{
 for(const query of [{startDate:'2026-02-30'},{startDate:'bad'},{startDate:['2026-01-01']},{startDate:'2026-09-30',endDate:'2026-09-01'}])assert.throws(()=>parseEventFilters(query));
 for(const dates of [{startDate:'2026-09-01'},{endDate:'2026-09-30'},{}])assert.doesNotThrow(()=>parseEventFilters(dates));
});
test('SQL binds filters and restricts events and BEST4 to selected events',()=>{
 const q=filteredEventCatalog({format:'2block',startDate:'2026-09-01',endDate:'2026-09-30'});
 assert.deepEqual(q.params,['2block','2026-09-01','2026-09-30']);assert.match(q.sql,/format=\$1 AND event_date>=\$2::date AND event_date<=\$3::date/);
 assert.match(q.sql,/JOIN selected_events ev/);assert.deepEqual(filteredEventCatalog().params,[]);
 assert.equal(filteredEventCatalog({format:'invalid'}).params[0],'original');
});
