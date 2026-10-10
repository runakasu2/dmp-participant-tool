// Pairing lifecycle is separate from the data-owning memo renderer and its save API.
(() => {
  const status=document.getElementById('matching-status'),list=document.getElementById('matching-archive-list');
  let busy=false,version=0,deleteGroups=[],deleteTarget=null;
  const $=id=>document.getElementById('matching-delete-'+id),dialog=$('dialog');
  const providerNames={nojigiku:'のじぎく',tcg_meister:'TCGマイスター',sugatool:'スガツール'},formatNames={original:'オリジナル',advance:'アドバンス','2block':'2ブロック'};
  const text=(tag,value)=>{const element=document.createElement(tag);element.textContent=value;return element;};
  async function json(url,options){const r=await fetch(url,options),data=await r.json();if(!r.ok||!data.success)throw Error(data.error||'対戦表の操作に失敗しました。');return data;}
  const context=()=>window.getMemoMatchingContext?.();
  function setBusy(value){busy=value;for(const control of dialog.querySelectorAll('button,input'))control.disabled=value;document.getElementById('matching-delete-open').disabled=value;if(!value)$('execute').disabled=!deleteTarget;for(const button of list.querySelectorAll('button'))button.disabled=value;document.dispatchEvent(new CustomEvent('matching-operation-busy',{detail:value}));}
  const locked=()=>busy||context()?.busy;
  function renderArchiveList(archives){list.replaceChildren();for(const a of archives){const row=document.createElement('div');row.className='matching-archive-row';const open=document.createElement('button');open.type='button';open.textContent=`${a.event_date||'日付不明'} ${a.event_name||'大会名未取得'} ／ ${{nojigiku:'のじぎく',tcg_meister:'TCGマイスター',sugatool:'スガツール'}[a.provider]||a.provider} ／ ${a.round_count}回戦・${a.match_count}件`;open.title=`${a.provider} / ${a.source_key} / ShopID:${a.shop_id} EventID:${a.event_id} Seq:${a.seq}`;
    open.addEventListener('click',async()=>{if(locked())return;setBusy(true);try{const [matching,decks]=await Promise.all([json('/api/matching-archives/'+a.id),json('/api/decks?sort=usage')]);setBusy(false);document.dispatchEvent(new CustomEvent('memo-open-matching-archive',{detail:{matching,decks:decks.decks}}));status.textContent='保存済み対戦表を開きました。過去ラウンドへ切り替えられます。';}catch(e){status.textContent=e.message;}finally{setBusy(false);}});
    open.disabled=busy;row.append(open);list.append(row);}if(!archives.length)list.textContent='保存済み対戦表はありません。';}
  async function reload(){const request=++version;try{const data=await json('/api/matching-archives',{cache:'no-store'});if(request===version)renderArchiveList(data.archives);}catch(e){if(request===version)status.textContent=e.message;}}
  function chooseTournament(group){
    if(locked())return;deleteTarget=null;$('status').textContent='削除するアーカイブを確認してください。';$('choose').hidden=true;$('confirm').hidden=false;
    const first=group[0];$('event').textContent=`${first.event_name||'大会名未取得'} ／ ${first.event_date||'日付不明'}`;
    $('archives').replaceChildren(text('legend','実際に削除するアーカイブ'));
    $('archives').append(text('p',`ShopID:${first.shop_id} / EventID:${first.event_id} / Seq:${first.seq}`));
    for(const archive of group){const label=document.createElement('label'),input=document.createElement('input');input.type='radio';input.name='matching-delete-archive';input.value=archive.id;
      label.append(input,text('span',`アーカイブ #${archive.id} ／ ${providerNames[archive.provider]||archive.provider} ／ 外部大会ID：${archive.source_key} ／ ${archive.round_count}回戦・${archive.match_count}試合`));
      input.addEventListener('change',()=>{if(locked())return;deleteTarget=archive;$('execute').disabled=false;});$('archives').append(label);
      if(group.length===1){input.checked=true;deleteTarget=archive;}
    }
    if(group.length>1)$('archives').append(text('p','同じ大会に複数の保存元があります。削除するアーカイブを1件選択してください。他の保存元は保持します。'));
    $('execute').disabled=!deleteTarget;$('back').focus();
  }
  function showTournaments(){deleteTarget=null;$('choose').hidden=false;$('confirm').hidden=true;$('execute').disabled=true;$('events').replaceChildren();
    for(const group of deleteGroups){const first=group[0],button=text('button',`${first.event_date||'日付不明'} ${first.event_name||'大会名未取得'} ／ ${formatNames[first.format]||'形式未登録'} ／ ${group.map(a=>a.round_count+'回戦').join('・')}（${group.length}アーカイブ）`);button.type='button';button.dataset.archiveIds=group.map(a=>a.id).join(',');button.title=`ShopID:${first.shop_id} / EventID:${first.event_id} / Seq:${first.seq}`;button.addEventListener('click',()=>chooseTournament(group));$('events').append(button);}
    if(!deleteGroups.length)$('events').textContent='削除対象の保存済み対戦表はありません。';
  }
  async function deletionList(){const data=await json('/api/matching-archives',{cache:'no-store'}),groups=new Map();for(const archive of data.archives){const key=JSON.stringify([archive.shop_id,archive.event_id,archive.seq]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(archive);}deleteGroups=[...groups.values()];showTournaments();return data.archives;}
  document.getElementById('matching-delete-open').addEventListener('click',async()=>{
    if(locked())return;deleteTarget=null;$('choose').hidden=false;$('confirm').hidden=true;$('events').replaceChildren();$('status').textContent='保存済み大会を読み込み中…';dialog.showModal();setBusy(true);
    try{await deletionList();$('status').textContent='';}catch(error){$('status').textContent=error.message;}finally{setBusy(false);}
  });
  $('back').addEventListener('click',()=>{if(locked())return;showTournaments();$('status').textContent='';});
  $('cancel').addEventListener('click',()=>{if(busy)return;dialog.close();});
  dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  dialog.addEventListener('close',()=>{deleteTarget=null;$('execute').disabled=true;document.getElementById('matching-delete-open').focus();});
  $('execute').addEventListener('click',async()=>{
    if(locked()||!deleteTarget||$('confirm').hidden)return;
    const archive=deleteTarget;setBusy(true);$('status').textContent='保存済み対戦表を削除中…';
    try{
      await json('/api/matching-archives/'+archive.id+'/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirmed:true,shopId:archive.shop_id,eventId:archive.event_id,seq:archive.seq})});
      deleteTarget=null;document.dispatchEvent(new CustomEvent('matching-archive-deleted',{detail:{archiveId:archive.id}}));
      const message=`${archive.event_name||'大会名未取得'}のアーカイブ #${archive.id}を削除しました。デッキメモ・大会結果は保持しています。`;
      status.textContent=message;await reload();
      try{const archives=await deletionList();renderArchiveList(archives);$('status').textContent=message;status.textContent=message;}catch(error){$('confirm').hidden=true;$('choose').hidden=false;$('events').replaceChildren();$('status').textContent=message+' 一覧の再取得に失敗しました。閉じて再度開いてください。';status.textContent=$('status').textContent;}
    }catch(error){$('status').textContent=error.message;status.textContent=error.message;}
    finally{setBusy(false);}
  });
  document.getElementById('matching-save').addEventListener('click',async()=>{const c=context();if(locked()||!c)return;
    if(c.provider==='tcg_meister'){const count=document.getElementById('matching-tcg-rounds').value;const settings={finalRound:count?Number(count):null,initialScore:document.getElementById('matching-tcg-zero').checked?0:null,zeroGainOutcome:document.getElementById('matching-tcg-double-loss').checked?'double_loss':null};if(settings.finalRound!==null||settings.initialScore!==null||settings.zeroGainOutcome!==null){if(!confirm(`この大会（ShopID:${c.shopId} / EventID:${c.eventId} / Seq:${c.seq} / tid:${new URL(c.url).searchParams.get('tid')}）の条件を確認しましたか？\n予選総回戦：${settings.finalRound??'未確認'}\n開始0点：${settings.initialScore===0?'確認済み':'未確認'}\n0/0の両者敗北：${settings.zeroGainOutcome?'確認済み':'未確認'}`))return;settings.confirmed=true;}c.tcgSettings=settings;}
    setBusy(true);document.getElementById('matching-save').disabled=true;status.textContent='全ラウンドの対戦表を保存中…';try{const data=await json('/api/matching-archives',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(c)});const message=data.noData?data.message:`対戦表を保存しました（今回取得：${data.roundCount}回戦・${data.matchCount}件）。`;await reload();if(!data.noData){const [matching,decks]=await Promise.all([json('/api/matching-archives/'+data.archiveId),json('/api/decks?sort=usage')]);setBusy(false);document.dispatchEvent(new CustomEvent('memo-open-matching-archive',{detail:{matching,decks:decks.decks,displayRound:c.displayRound}}));}status.textContent=message;}catch(e){status.textContent=e.message;}finally{setBusy(false);document.getElementById('matching-save').disabled=Boolean(context()?.busy||!context()?.shopId||!['nojigiku','tcg_meister','sugatool'].includes(context()?.provider));}});
  document.getElementById('matching-reload').addEventListener('click',reload);
  document.addEventListener('matching-archives-refresh',reload);
})();
