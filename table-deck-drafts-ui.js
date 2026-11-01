/* Candidate inputs are deliberately separate from immediately-saved normal selects. */
window.attachTableDrafts=async function({loaded,visible,round,bindings,decks,isCurrent,reload,busy}){
 if(!loaded.memoEventId||!round)return;
 const key=p=>loaded.provider==='tcg_meister'||!p.dmpId?(p.participantKey?'key:'+p.participantKey:null):'dmp:'+p.dmpId;
 let drafts=[];
 async function request(body){const response=await fetch('/api/deck-memo/table-drafts'+(body?'':'?memoEventId='+loaded.memoEventId),body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:loaded.sourceUrl,memoEventId:loaded.memoEventId,...body})}:{cache:'no-store'});const data=await response.json();if(!response.ok||!data.success)throw Error(data.error||'仮登録を取得できませんでした。');return data;}
 const name=id=>decks.find(d=>d.id===id)?.name||'デッキ #'+id;
 function panel(title,build){
 const dialog=document.createElement('dialog');dialog.className='memo-draft-dialog';
 const heading=document.createElement('strong');heading.textContent=title;const content=document.createElement('div'),message=document.createElement('p'),close=document.createElement('button');close.textContent='閉じる';close.type='button';close.onclick=()=>dialog.close();dialog.append(heading,content,message,close);document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove());
 const action=(label,fn)=>{const button=document.createElement('button');button.type='button';button.textContent=label;button.onclick=async()=>{if(busy())return;const buttons=[...dialog.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);try{await fn();dialog.close();await reload();}catch(e){message.textContent=e.message;buttons.forEach(b=>b.disabled=false);}};content.append(button);};build(content,action);dialog.showModal();
 }
 try{drafts=(await request()).drafts;}catch(e){if(isCurrent())for(const b of bindings){b.select.title=e.message;}return;}
 if(!isCurrent())return;
 for(const b of bindings){
 const p=b.player,k=key(p),pair=visible.filter(x=>x.table!=null&&String(x.table)===String(p.table));
 const keys=pair.map(key).sort(),valid=pair.length===2&&!pair.some(x=>x.bye||!key(x))&&keys[0]!==keys[1]&&keys.every(k=>visible.filter(x=>key(x)===k).length===1);
 const own=drafts.find(d=>d.round===round&&String(d.table_no)===String(p.table)&&JSON.stringify(d.pair)===JSON.stringify(keys));
 const wrap=document.createElement('span');wrap.className='memo-draft-actions';
 const provisional=document.createElement('button');provisional.type='button';provisional.className='memo-draft-toggle';provisional.textContent='仮';provisional.setAttribute('aria-label',p.name+'の卓を仮登録');provisional.setAttribute('aria-pressed',String(!!own));provisional.disabled=!valid||b.select.dataset.memoReadOnly==='true';provisional.title=valid?'卓の2件の候補を入力（確定メモは変更しません）':'2人の参加者を識別できる卓のみ仮登録できます';
 provisional.onclick=()=>{if(busy())return;if(own)panel('この卓の仮登録', (content,action)=>{const info=document.createElement('p');info.textContent=own.decks.map(name).join(' / ')+'（解除しても確定メモは保持）';content.append(info);action('仮登録を解除',()=>request({action:'cancel',id:own.id}));});else panel('卓のデッキ候補を仮登録',(content,action)=>{
 const info=document.createElement('p');info.textContent='2人の対応が不明なデッキを選択。確定メモ・集計には反映しません。';content.append(info);
 const selects=pair.map(x=>{const s=createDeckSelect(decks,{format:loaded.event?.format||loaded.format,deckId:x.deckId,deckName:x.deckName,label:'卓のデッキ候補'});content.append(s);return s;});
 action('2件を仮登録',()=>{if(selects.some(s=>!s.value))throw Error('両方のデッキ候補を選択してください。');return request({action:'create',round,table:p.table,players:pair,decks:selects.map(s=>Number(s.value))});});
 });};wrap.append(provisional);
 const candidates=drafts.filter(d=>d.round<=round&&d.pair.includes(k));
 if(candidates.length){const candidate=document.createElement('button');candidate.type='button';candidate.className='memo-draft-candidates';const pending=candidates.some(d=>d.resolved[k]==null);candidate.textContent=pending?'候補':'確定済';candidate.title='過去の仮登録候補と確認状態';candidate.onclick=()=>panel(p.name+'の候補',(content,action)=>{
 for(const d of candidates){const text=document.createElement('p');text.textContent='Round '+d.round+' / 卓 '+d.table_no+'：'+d.decks.map(name).join(' / ');content.append(text);
 if(d.resolved[k]!=null){const done=document.createElement('small');done.textContent='確認済：'+name(d.resolved[k])+'（現在のメモはプルダウンを参照）';content.append(done);continue;}
 const remaining=[...d.decks],other=d.pair.find(x=>x!==k),used=d.resolved[other];if(used!=null){const i=remaining.indexOf(used);if(i>=0)remaining.splice(i,1);}
 for(const id of new Set(remaining))action(name(id)+'で確定',()=>request({action:'confirm',id:d.id,key:k,deckId:id}));
 } });wrap.append(candidate);}
 b.select.parentElement.querySelectorAll('.memo-draft-actions').forEach(el=>el.remove());
 b.select.parentElement.append(wrap);
 }
};
