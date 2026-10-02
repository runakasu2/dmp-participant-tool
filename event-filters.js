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
if(typeof module!=='undefined')module.exports={parseEventFilters,eventFilterQuery};
