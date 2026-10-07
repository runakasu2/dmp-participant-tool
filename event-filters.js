function parseEventFilters(query={}){
 const format=['original','advance','2block'].includes(query.format)?query.format:'original';
 const dates={};
 for(const name of ['startDate','endDate']){
  const value=query[name]??'';
  if(typeof value!=='string'||value&&(!/^\d{4}-\d{2}-\d{2}$/.test(value)||value<'0001-01-01'||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value))throw Error('期間は有効な日付で指定してください。');
  dates[name]=value;
 }
 if(dates.startDate&&dates.endDate&&dates.startDate>dates.endDate)throw Error('開始日は終了日以前にしてください。');
 return {format,...dates};
}
function eventFilterQuery(filters){const q=new URLSearchParams({format:filters.format});for(const key of ['startDate','endDate'])if(filters[key])q.set(key,filters[key]);return q.toString();}
// Browser-side filtering only; keep server date/format queries unchanged.
function filterEventsByName(events,query=''){
 const normalize=value=>String(value??'').normalize('NFKC').toLocaleLowerCase('ja').trim();
 const name=normalize(query);
 return events.filter(event=>!name||normalize(event.event_name).includes(name));
}
if(typeof module!=='undefined')module.exports={parseEventFilters,eventFilterQuery,filterEventsByName};
