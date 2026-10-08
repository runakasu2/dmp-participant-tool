function createEventCard(event, controls, openDetail) {
  function node(tag, className, text) {
    const el=document.createElement(tag);el.className=className;
    if(text!==undefined)el.textContent=text;return el;
  }
  const card=node('article','event-card');card.tabIndex=0;card.setAttribute('role','button');
  card.setAttribute('aria-label',event.event_name||'大会名未取得');
  function activate(){if(!controls.rowClick(event.id))openDetail(event);}
  card.addEventListener('click',activate);
  card.addEventListener('keydown',e=>{if(e.target===card&&(e.key==='Enter'||e.key===' ')){e.preventDefault();activate();}});
  const hero=node('div','event-card-hero');
  const placeholder=node('span','event-card-placeholder',Array.from(event.event_name||'CS').slice(0,2).join(''));
  hero.appendChild(placeholder);
  function setImage(url) {
    if(hero.querySelector('img'))hero.querySelector('img').remove();
    if(!url)return;
    const img=node('img','event-card-image');img.alt='';img.loading='lazy';img.referrerPolicy='no-referrer';
    img.addEventListener('error',()=>img.remove());img.src=url;hero.appendChild(img);attachCardArt(img,hero);
  }
  setImage((event.best_four||[]).find(p=>p.rank===1)?.deckImageUrl);card.appendChild(hero);
  const body=node('div','event-card-body');
  const info=node('div','event-card-info');
  info.appendChild(node('p','event-card-date',event.event_date?new Date(event.event_date).toLocaleDateString('ja-JP',{timeZone:'Asia/Tokyo'}):'開催日未取得'));
  info.appendChild(node('h3','event-card-name',event.event_name||'大会名未取得'));
  info.appendChild(node('p','event-card-count','参加人数：'+(event.participant_count||0)+'人'));
  hero.appendChild(info);
  const best=node('div','event-card-best');best.appendChild(node('h4','','BEST 4'));
  const players=event.best_four||[];
  if(!players.length)best.appendChild(node('p','event-card-empty',event.result_count?'4位以内の順位データなし':'大会結果未取得'));
  for(const p of players){
    const row=node('div','event-card-result');row.appendChild(node('span','event-card-rank',p.rank+'位'));
    const details=node('div','');details.appendChild(node('strong','',p.handleName||p.dmpId));details.appendChild(node('div','event-card-deck',p.deckName||'未登録'));
    details.title=(p.handleName||p.dmpId)+' / '+(p.deckName||'未登録')+' / DMP ID：'+p.dmpId;
    row.appendChild(details);best.appendChild(row);
  }
  body.appendChild(best);
  card.appendChild(body);
  card.appendChild(controls.cell(event,card));return card;
}
