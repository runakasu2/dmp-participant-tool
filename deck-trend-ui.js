function buildTrendSeries(data){
  const map=new Map();
  for(const event of data.events)for(const deck of event.decks){
    const key=deck.deckId == null?'name:'+deck.deckName:'id:'+deck.deckId;
    if(!map.has(key))map.set(key,{key,deckName:deck.deckName,total:0,counts:new Map()});
    const series=map.get(key);series.total+=deck.count;series.counts.set(event.eventRecordId,deck.count);
  }
  const series=Array.from(map.values()).sort((a,b)=>b.total-a.total||a.deckName.localeCompare(b.deckName,'ja'));
  series.push({key:'unknown',deckName:'未登録',unknown:true,counts:new Map(data.events.map(e=>[e.eventRecordId,e.unregisteredCount]))});
  return series.map(s=>({...s,points:data.events.map(event=>{
    const count=s.counts.get(event.eventRecordId)||0;
    return {event,count,percentage:count/event.participantCount*100};
  })}));
}
function trendPointDescription(series,point){
  const e=point.event;
  return `${e.eventDate} ${e.eventName} ／ ${series.deckName}：${point.count}人・${point.percentage.toFixed(1)}% ／ 参加者${e.participantCount}人 ／ 登録 ${e.registeredDeckCount} / ${e.participantCount}人`;
}
function renderDeckTrend(container,series,mode,onPoint){
  container.replaceChildren();
  if(!series.length){container.textContent='表示するデッキを選択してください。';return;}
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');
  const events=series[0].points.map(p=>p.event),width=Math.max(720,events.length*95+90),height=340;
  const left=55,right=25,top=20,bottom=55,plotWidth=width-left-right,plotHeight=height-top-bottom;
  let maximum=0;for(const s of series)for(const p of s.points)maximum=Math.max(maximum,mode==='count'?p.count:p.percentage);
  const max=Math.max(5,Math.ceil(maximum/5)*5);
  const x=i=>left+(events.length>1?i/(events.length-1):0.5)*plotWidth;
  const y=value=>top+plotHeight-value/max*plotHeight;
  function node(tag,attrs,text){const el=document.createElementNS(ns,tag);for(const [k,v]of Object.entries(attrs))el.setAttribute(k,String(v));if(text!==undefined)el.textContent=text;svg.appendChild(el);return el;}
  svg.setAttribute('viewBox',`0 0 ${width} ${height}`);svg.style.width=width+'px';svg.setAttribute('aria-label','大会ごとのデッキ'+(mode==='count'?'人数':'使用率')+'推移');
  for(let i=0;i<=5;i++){const value=max*i/5;node('line',{x1:left,x2:width-right,y1:y(value),y2:y(value),stroke:'#d8dde5'});node('text',{x:left-8,y:y(value)+4,'text-anchor':'end'},value+(mode==='count'?'人':'%'));}
  events.forEach((e,i)=>node('text',{x:x(i),y:height-25,'text-anchor':'middle'},e.eventDate.slice(5).replace('-','/')));
  for(const s of series){
    const color=deckPieColor(s),points=s.points.map((p,i)=>`${x(i)},${y(mode==='count'?p.count:p.percentage)}`).join(' ');
    node('polyline',{points,fill:'none',stroke:color,'stroke-width':2});
    s.points.forEach((p,i)=>{
      const label=trendPointDescription(s,p),point=node('circle',{cx:x(i),cy:y(mode==='count'?p.count:p.percentage),r:6,fill:color,stroke:'white','stroke-width':1,tabindex:0,role:'button','aria-label':label});
      const title=document.createElementNS(ns,'title');title.textContent=label;point.appendChild(title);
      const show=()=>onPoint(label);point.addEventListener('click',show);point.addEventListener('focus',show);point.addEventListener('mouseenter',show);point.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();show();}});
    });
  }
  container.appendChild(svg);
}
function createDeckTrendControls(readFilters){
  const panel=document.getElementById('deck-trends'),status=document.getElementById('deck-trend-status'),choices=document.getElementById('deck-trend-choices'),chart=document.getElementById('deck-trend-chart'),detail=document.getElementById('deck-trend-point');
  let version=0,data=null,series=[],selected=new Set(),mode='percentage';
  function render(){
    detail.textContent='ポイントをタップすると大会名・人数・使用率を確認できます。';
    for(const value of ['percentage','count'])document.getElementById('trend-'+value).setAttribute('aria-pressed',String(mode===value));
    renderDeckTrend(chart,series.filter(s=>selected.has(s.key)),mode,text=>{detail.textContent=text;});
  }
  function clear(){version++;data=null;series=[];selected.clear();panel.hidden=true;chart.replaceChildren();choices.replaceChildren();}
  async function load(){
    let filters;try{filters=readFilters();}catch(error){clear();panel.hidden=false;status.textContent=error.message;return;}
    clear();const request=version;panel.hidden=false;status.textContent='母数推移を取得中...';detail.textContent='';
    try{
      const response=await fetch('/api/deck-trends?'+eventFilterQuery(filters),{cache:'no-store'}),result=await response.json();
      if(request!==version)return;if(!response.ok||!result.success)throw Error(result.error||'取得できませんでした。');
      data=result;series=buildTrendSeries(data);mode='percentage';selected=new Set(series.filter(s=>!s.unknown).slice(0,5).map(s=>s.key));
      status.textContent=`${DECK_FORMAT_LABELS[data.format]} ／ ${data.events.length}大会 ／ 母数未入力・参加人数または日付不明のため除外：${data.excludedEvents.length}大会`;
      if(!data.events.length){chart.textContent='条件に一致する母数データがありません。';return;}
      for(const s of series){
        const label=document.createElement('label'),input=document.createElement('input'),swatch=document.createElement('span');
        input.type='checkbox';input.checked=selected.has(s.key);swatch.className='trend-swatch';swatch.style.background=deckPieColor(s);
        input.addEventListener('change',()=>{if(input.checked)selected.add(s.key);else selected.delete(s.key);render();});
        label.append(input,swatch,document.createTextNode(s.deckName));choices.appendChild(label);
      }
      render();
    }catch(error){if(request===version)status.textContent=error.message;}
  }
  document.getElementById('show-deck-trends').addEventListener('click',load);
  for(const value of ['percentage','count'])document.getElementById('trend-'+value).addEventListener('click',()=>{mode=value;if(data?.events.length)render();});
  for(const id of ['events-start-date','events-end-date'])document.getElementById(id).addEventListener('input',clear);
  return {clear,load};
}
if(typeof module!=='undefined')module.exports={buildTrendSeries,trendPointDescription};
