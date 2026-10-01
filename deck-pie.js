let deckPieInstance=0;
function eventSummaryItems(data){
 return [...(data.decks||[]),{deckName:'未登録',count:data.unregisteredCount||0,
 percentage:data.participantCount>0?((data.unregisteredCount||0)/data.participantCount*100).toFixed(1):'0.0',unknown:true}];
}
// Presentation-only grouping. Never mutate the API/summary objects used by lists.
function buildPieChartItems(items,options={}){
 const threshold=options.minIndividualCount??2;
 const total=options.total??items.reduce((sum,item)=>sum+Number(item.count),0);
 const individual=[],unknown=[];let otherCount=0;
 for(const item of items){
  if(item.unknown)unknown.push({...item});
  else if(Number(item.count)<threshold)otherCount+=Number(item.count);
  else individual.push({...item});
 }
 if(otherCount>0)individual.push({deckName:'その他',count:otherCount,
  percentage:total>0?(otherCount/total*100).toFixed(1):'0.0',other:true});
 return [...individual,...unknown];
}
function deckPieColor(item){
 if(item.other)return '#747b85';
 if(item.unknown)return '#9299a3';
 let hash=2166136261;for(const c of item.deckName)hash=Math.imul(hash^c.codePointAt(0),16777619);
 return `hsl(${(hash>>>0)%360} 65% ${42+(hash>>>8)%15}%)`;
}
function renderDeckPieChart(container,items,options={}){
 container.replaceChildren();
 const total=items.reduce((n,item)=>n+Number(item.count),0);
 function text(tag,value){const el=document.createElement(tag);el.textContent=value;return el;}
 if(!total){container.appendChild(text('p','表示できる母数データがありません'));return;}
 if(options.total!==undefined&&total!==Number(options.total)){
  container.appendChild(text('p','母数の合計と参加者数が一致しないため円グラフを表示できません。リストをご確認ください。'));return;
 }
 items=buildPieChartItems(items,options);
 const ns='http://www.w3.org/2000/svg';const svg=document.createElementNS(ns,'svg');
 svg.setAttribute('viewBox','0 0 240 240');svg.setAttribute('role','img');svg.setAttribute('aria-label','デッキ母数の円グラフ。人数と使用率は凡例に記載。');
 const instance=++deckPieInstance;let slice=0;
 const outerLabels=[];
 const legend=document.createElement('ul');legend.className='deck-pie-legend';let angle=-Math.PI/2;
 for(const item of items){
  const label=`${item.deckName}　${item.count}人　${item.percentage}%`;const color=deckPieColor(item);
  if(item.count>0){
   const start=angle;
   const end=angle+Number(item.count)/total*2*Math.PI;
   const shape=document.createElementNS(ns,Number(item.count)===total?'circle':'path');
   if(Number(item.count)===total){shape.setAttribute('cx','120');shape.setAttribute('cy','120');shape.setAttribute('r','110');}
   else shape.setAttribute('d',`M120 120 L${120+110*Math.cos(angle)} ${120+110*Math.sin(angle)} A110 110 0 ${end-angle>Math.PI?1:0} 1 ${120+110*Math.cos(end)} ${120+110*Math.sin(end)} Z`);
   shape.setAttribute('fill',color);shape.setAttribute('stroke','white');shape.setAttribute('stroke-width','1');
   const title=document.createElementNS(ns,'title');title.textContent=label;shape.appendChild(title);svg.appendChild(shape);
   const imageUrl=!item.unknown&&!item.other&&/^https:\/\//i.test(item.image_url||'')?item.image_url:null;
   if(imageUrl){
    const clip=document.createElementNS(ns,'clipPath');const clipId=`deck-pie-${instance}-${slice++}`;
    clip.setAttribute('id',clipId);clip.setAttribute('clipPathUnits','userSpaceOnUse');clip.appendChild(shape.cloneNode(false));
    const defs=document.createElementNS(ns,'defs');defs.appendChild(clip);svg.appendChild(defs);
    const image=document.createElementNS(ns,'image');image.setAttribute('href',imageUrl);
    // Wait for natural dimensions; keep the fallback sector visible until loaded.
    image.setAttribute('visibility','hidden');
    const original=new Image();original.referrerPolicy='no-referrer';
    original.onload=()=>{
     const geometry=(typeof module!=='undefined'?require('./card-art').sliceArtGeometry:sliceArtGeometry)(start,end,original.naturalWidth,original.naturalHeight);
     for(const key of ['x','y','width','height'])image.setAttribute(key,geometry[key]);
     image.setAttribute('visibility','visible');
    };
    original.onerror=()=>image.remove();original.src=imageUrl;
    image.setAttribute('preserveAspectRatio','xMidYMid slice');image.setAttribute('clip-path',`url(#${clipId})`);
    image.setAttribute('pointer-events','none');image.addEventListener('error',()=>image.remove());svg.appendChild(image);
    const border=shape.cloneNode(true);border.setAttribute('fill','transparent');svg.appendChild(border);
   }
   outerLabels.push({item,angle:(start+end)/2});angle=end;
  }
  const row=text('li',label);const swatch=document.createElement('span');swatch.className='deck-pie-swatch';swatch.style.backgroundColor=color;swatch.setAttribute('aria-hidden','true');if(!item.unknown&&!item.other&&/^https:\/\//i.test(item.image_url||'')){
   const thumb=document.createElement('img');thumb.src=item.image_url;thumb.alt='';thumb.loading='lazy';thumb.referrerPolicy='no-referrer';thumb.addEventListener('error',()=>thumb.remove());swatch.appendChild(thumb);
  }
  row.prepend(swatch);legend.appendChild(row);
 }
 if(outerLabels.length<=12){
  svg.classList.add('deck-pie-labeled');svg.setAttribute('viewBox','-140 -20 520 280');
  for(const side of [-1,1]){
   const labels=outerLabels.filter(p=>(Math.cos(p.angle)<0?-1:1)===side).sort((a,b)=>Math.sin(a.angle)-Math.sin(b.angle));
   labels.forEach((p,i)=>{
    const y=labels.length===1?120:10+i*220/(labels.length-1);
    const line=document.createElementNS(ns,'path');line.setAttribute('class','deck-pie-outer-label');line.setAttribute('d',`M${120+110*Math.cos(p.angle)} ${120+110*Math.sin(p.angle)} L${120+side*120} ${y} L${120+side*130} ${y}`);line.setAttribute('stroke','#777');line.setAttribute('stroke-width','.7');line.setAttribute('fill','none');svg.appendChild(line);
    const label=document.createElementNS(ns,'text');label.setAttribute('class','deck-pie-outer-label');label.setAttribute('x',120+side*132);label.setAttribute('y',y);label.setAttribute('text-anchor',side<0?'end':'start');label.setAttribute('font-size','8');
    label.textContent=(p.item.deckName.length>12?p.item.deckName.slice(0,12)+'…':p.item.deckName)+' '+p.item.percentage+'%';svg.appendChild(label);
   });
  }
 }
 container.appendChild(svg);container.appendChild(legend);
}
function setDeckSummaryView(mode,prefix="deck"){
 const pie=mode==='pie';document.getElementById(prefix+'-summary-table').hidden=pie;document.getElementById(prefix+'-summary-pie').hidden=!pie;
 for(const name of ['list','pie']){const button=document.getElementById(prefix+'-view-'+name);button.setAttribute('aria-pressed',String(name===mode));}
}
if(typeof module!=='undefined')module.exports={buildPieChartItems,eventSummaryItems,deckPieColor,renderDeckPieChart,setDeckSummaryView};
