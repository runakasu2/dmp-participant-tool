// Use one normalized roster for both visible matching rows and the summary.
function normalizeMemoMatching(matching) {
  const tcg=matching.provider==='tcg_meister';
  const seen=new Set();
  const participants=(matching.participants||[]).filter(player=>{
    if(!tcg)return true;
    const name=String(player.name??player.handleName??'').trim();
    if(!name||/^(?:bye(?:\s*[（(]不戦勝[）)])?|不戦勝)$/i.test(name))return false;
    if(player.round!=null&&matching.latestRound!=null&&Number(player.round)!==Number(matching.latestRound))return false;
    const key=player.internalParticipantId!=null?'id:'+player.internalParticipantId:player.participantKey;
    if(key&&seen.has(key))return false;
    if(key)seen.add(key);
    return true; // bye=true denotes the real player, not the placeholder opponent.
  });
  return {...matching,participants,participantCount:participants.length};
}
(() => {
  const menu = document.getElementById('menu-deck-memo');
  const page = document.getElementById('page-deck-memo');
  const input = document.getElementById('memo-url');
  const dmpInput = document.getElementById('memo-dmp-url');
  const eventInfo = document.getElementById('memo-event-info');
  const archiveSave = document.getElementById('memo-archive-save');
  const archiveSaveStatus = document.getElementById('memo-archive-save-status');
  let archiveBusy = false;
  let openedArchive = null;
  const resetArchive = document.getElementById('memo-archive-reset');
  let selects = [];
  const refresh = document.getElementById('memo-refresh');
  const status = document.getElementById('memo-status');
  const summary = document.getElementById('memo-summary');
  const list = document.getElementById('memo-list');
  const roundSelect=document.getElementById('memo-round');
  let displayRound=null,deckCatalog=[],pairingBusy=false;
  let current = null;
  let saving = 0;
  let matchingDiagnostic=null;
  const author=document.getElementById('memo-author');
  const own=document.getElementById('memo-own');
  const ownList=document.getElementById('memo-own-list');
  const ownChoice=document.getElementById('memo-own-choice');
  const manual=document.getElementById('memo-manual-refresh');
  const syncStatus=document.getElementById('memo-sync-status');
  const clientId=typeof crypto!=='undefined'?crypto.randomUUID():String(Math.random());
  let chosenIdentity='', bindings=[], stream=null, syncTimer=null, syncBusy=false, syncAgain=false, generation=0;
  const identity=p=>p.dmpId?'dmp:'+p.dmpId:p.participantKey?'key:'+p.participantKey:'entry:'+p.entryNo;
  try {author.value=localStorage.getItem('deck-memo-author')||'';}catch {}
  author.addEventListener('input',()=>{try{localStorage.setItem('deck-memo-author',author.value);}catch{} chosenIdentity='';if(current)render(deckCatalog);});
  function updateBindings(except){
    for(const b of bindings){
      if(b===except||b.select===document.activeElement||b.pending)continue;
      b.select.value=b.player.deckId==null?'':String(b.player.deckId);
      b.show(b.player.deckId==null?'未登録':'登録済み',b.player.deckId==null?'empty':'saved');
    }
  }
  function closeStream(){stream?.close();stream=null;generation++;if(syncTimer!==null){clearTimeout(syncTimer);syncTimer=null;}}
  function queueSync(){if(syncTimer!==null)return;syncTimer=setTimeout(()=>{syncTimer=null;void refreshState();},180);}
  async function refreshState(){
    if(!current?.memoEventId)return;
    if(syncBusy||saving||pairingBusy||archiveBusy){syncAgain=true;return;}
    syncBusy=true;manual.disabled=true;
    const loaded=current,version=generation;
    syncStatus.textContent='更新中…';
    try{
      const data=await getJson('/api/deck-memo/state?memoEventId='+loaded.memoEventId,{cache:'no-store'});
      if(current!==loaded||version!==generation)return;
      if(saving){syncAgain=true;return;}
      const byDmp=new Map(data.players.filter(p=>p.dmp_id).map(p=>[String(p.dmp_id),p]));
      const byKey=new Map(data.players.filter(p=>p.participant_key).map(p=>[p.participant_key,p]));
      for(const p of [...loaded.participants,...(loaded.rounds||[]).flatMap(r=>r.participants)]){
        const saved=p.participantKey?byKey.get(p.participantKey)||byDmp.get(String(p.dmpId)):byDmp.get(String(p.dmpId));
        p.deckId=saved?.deck_id??null;p.deckName=saved?.deck_name??null;
      }
      updateBindings();updateSummary();syncStatus.textContent=data.deleted?'メモは削除されています。対戦表を再取得してください。':'更新しました。';
    }catch(error){if(current===loaded)syncStatus.textContent=error.message;}
    finally{syncBusy=false;manual.disabled=!current?.memoEventId;if(syncAgain&&!saving&&!pairingBusy&&!archiveBusy){syncAgain=false;queueSync();}}
  }
  function connectStream(){
    closeStream();manual.disabled=!current?.memoEventId;
    if(typeof EventSource==='undefined'||!current?.memoEventId||page.style.display==='none')return;
    stream=new EventSource('/api/deck-memo/events?memoEventId='+current.memoEventId);
    stream.addEventListener('ready',queueSync);
    stream.addEventListener('change',event=>{try{const data=JSON.parse(event.data);if(data.origin===clientId&&!saving&&data.players&&current){const byKey=new Map(data.players.map(p=>[p.participant_key?'key:'+p.participant_key:'dmp:'+p.dmp_id,p]));if([...current.participants,...(current.rounds||[]).flatMap(r=>r.participants)].every(p=>{const saved=byKey.get(identity(p));return (saved?.deck_id??null)===(p.deckId??null)&&(saved?.deck_name??null)===(p.deckName??null);}))return;}}catch{}queueSync();});
    stream.onerror=()=>{syncStatus.textContent='接続を復旧中…（手動更新も利用できます）';};
  }
  manual.addEventListener('click',()=>refreshState());
  if(typeof MutationObserver!=='undefined')new MutationObserver(()=>{if(page.style.display==='none')closeStream();else if(!stream)connectStream();}).observe(page,{attributes:true,attributeFilter:['style']});
  if(typeof window!=='undefined'&&window.addEventListener){window.addEventListener('pagehide',closeStream);window.addEventListener('pageshow',()=>{if(page.style.display!=='none')connectStream();});}

  // Read-only diagnostic snapshot: never includes URLs, names, DMP IDs or credentials.
  if(typeof window!=='undefined')window.getDeckMemoDiagnostic=()=>({
    build:'memo-count-diagnostic-20261001',
    response:matchingDiagnostic,
    state:current?{provider:current.provider,latestRound:current.latestRound,
      participantCount:current.participantCount,arrayLength:current.participants.length}:null,
    visibleRowCount:list.children.length,
    summaryText:summary.textContent,
    summaryElementCount:document.querySelectorAll('[id="memo-summary"]').length,
    listElementCount:document.querySelectorAll('[id="memo-list"]').length,
    archiveVisible:!document.getElementById('memo-archive-detail').hidden,
    archiveSummaryText:document.getElementById('memo-archive-info').textContent
  });
  menu.addEventListener('click', () => {
    hideAllPages(); clearActiveMenus();
    page.style.display = 'block'; menu.classList.add('active');
    connectStream();
    void loadArchives();
    document.dispatchEvent(new Event('matching-archives-refresh'));
  });
  const updateSummary = () => {
    document.getElementById('matching-tcg-settings').hidden=current?.provider!=='tcg_meister';
    roundSelect.disabled = !current?.rounds?.length || saving > 0 || archiveBusy || pairingBusy;
    document.getElementById('matching-save').disabled = !current?.event || !['nojigiku','tcg_meister','sugatool'].includes(current.provider) || saving > 0 || archiveBusy || pairingBusy;
    document.dispatchEvent(new Event('matching-context-change'));
    document.getElementById('memo-provisional-apply').disabled = !current?.event || !current.participants.length || (current.saved&&!current.memoEventId) || saving > 0 || archiveBusy || pairingBusy;
    archiveSave.disabled = !current?.event || !current.participants.length || (current.saved&&!current.memoEventId) || saving > 0 || archiveBusy || pairingBusy;
    if (!current) { own.hidden=true;manual.disabled=true;if(stream)closeStream(); summary.textContent = ''; eventInfo.textContent = ''; return; }
    eventInfo.textContent = current.event ? '大会名：' + current.event.eventName + ' ／ 開催日：' + current.event.eventDate : '';
    const visible=current.rounds?.find(r=>r.round===displayRound)?.participants||current.participants;
    summary.textContent = (current.latestRound === null ? '未公開' : '表示：Round ' + (displayRound??current.latestRound) + ' ／ 最新：Round ' + current.latestRound) +
      ' ／ 参加者：' + visible.length + '人 ／ デッキ登録：' +
      visible.filter(player => player.deckId != null).length + ' / ' + visible.length +
      (current.provider === 'tcg_meister' ? ' ／ TCGマイスター tid：' : current.provider === 'sugatool' ? ' ／ スガツール event：' : ' ／ admin：') + current.adminKey;
  };
  async function getJson(url, options) {
    const response = await fetch(url, options);
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || '取得・保存に失敗しました。');
    return data;
  }
  function render(decks) {
    list.replaceChildren();
    selects = [];bindings=[];ownList.replaceChildren();ownChoice.replaceChildren();
    let previousTable = null, group = 0;
    const loaded = current;
    const visible=loaded.rounds?.find(r=>r.round===displayRound)?.participants||loaded.participants;
    const tcg = loaded.provider === 'tcg_meister';
    document.getElementById('memo-table-head').replaceChildren();
    for (const label of tcg ? ['卓','ハンドルネーム','使用デッキ'] : ['卓','DMP ID','ハンドルネーム','使用デッキ']) {
      const th = document.createElement('th'); th.textContent = label; document.getElementById('memo-table-head').appendChild(th);
    }
    const name=author.value.trim();own.hidden=!name;
    const candidates=visible.filter(p=>String(p.name||'').trim()===name);
    const unique=[...new Map(candidates.map(p=>[identity(p),p])).values()];
    let mine=unique.length===1?unique[0]:unique.find(p=>identity(p)===chosenIdentity);
    if(unique.length>1){
      const choice=document.createElement('select');choice.setAttribute('aria-label','同名プレイヤーの候補');
      const blank=document.createElement('option');blank.value='';blank.textContent='あなたのプレイヤーを選択';choice.append(blank);
      for(const p of unique){const option=document.createElement('option');option.value=identity(p);option.textContent=p.name+' ／ '+(p.dmpId?'DMP ID '+p.dmpId:p.participantKey||p.entryNo)+' ／ 卓 '+p.table;choice.append(option);}
      choice.value=mine?identity(mine):'';choice.addEventListener('change',()=>{chosenIdentity=choice.value;render(decks);});ownChoice.append(choice);
    }
    document.getElementById('memo-own-status').textContent=!unique.length?'該当する卓番がありません':!mine?'同名の候補から選択してください。':'';
    const ownPlayers=name&&mine?visible.filter(p=>p===mine||(mine.table!=null&&p.table===mine.table)):[];
    const ownHead=document.getElementById('memo-own-head');ownHead.replaceChildren();
    for(const label of tcg?['卓','ハンドルネーム','使用デッキ']:['卓','DMP ID','ハンドルネーム','使用デッキ']){const th=document.createElement('th');th.textContent=label;ownHead.append(th);}
    for (const [player,destination] of [...ownPlayers.map(p=>[p,ownList]),...visible.map(p=>[p,list])]) {
      const row = document.createElement('tr');
      if (previousTable !== player.table) { row.classList.add('memo-table-start'); group++; }
      if (group % 2) row.classList.add('memo-table-shade');
      previousTable = player.table;
      const values = tcg ? [player.bye ? '不戦勝' : player.table, player.name] : [player.table??'卓なし', player.dmpId??'未取得', player.name];
      for (const value of values) {
        const cell = document.createElement('td'); cell.textContent = value; row.appendChild(cell);
      }
      if(player.opponentName){row.title='対戦相手：'+player.opponentName;const detail=document.createElement('details');detail.className='matching-player-detail';const label=document.createElement('summary');label.textContent=player.name;const text=document.createElement('span');text.textContent='プレイヤー：'+player.name+' ／ 対戦相手：'+player.opponentName+' ／ '+(player.outcome==='win_loss'?(player.winnerKey===player.participantKey?'勝ち':'負け'):player.outcome==='double_loss'?'両者敗北':player.outcome==='bye'?'不戦勝表記／相手なし':'勝敗未判定');detail.append(label,text);row.cells[tcg?1:2].replaceChildren(detail);}
      const cell = document.createElement('td');
      const select = createDeckSelect(decks, {format:current.event?.format || current.format, deckId:player.deckId, deckName:player.deckName, label:player.name + 'の使用デッキ'});
      select.disabled=pairingBusy || ((!tcg||loaded.saved)&&!player.dmpId&&!player.memoExternal) || (loaded.saved && !loaded.memoEventId);
      select.dataset.memoReadOnly=String(select.disabled&&!pairingBusy);
      selects.push(select);
      const saved = document.createElement('small'); saved.setAttribute('role', 'status');
      const showSaveStatus = (text, state) => {
        saved.textContent = state==='saved'?'✓':state==='empty'?'未':state==='saving'?'…':'!';
        saved.setAttribute('aria-label', state==='saved'?'登録済み：'+text:state==='empty'?'未登録：'+text:text);
        saved.setAttribute('data-save-state', state);
        saved.setAttribute('title', text);
      };
      showSaveStatus(select.unmatchedDeckName ? '保存済み：' + select.unmatchedDeckName + '（一覧を再取得してください）' : player.deckId === null ? '未登録' : '保存済み',
        select.unmatchedDeckName ? 'warning' : player.deckId === null ? 'empty' : 'saved');
      const binding={player,select,show:showSaveStatus,pending:false};bindings.push(binding);
      select.addEventListener('blur',()=>updateBindings());
      select.addEventListener('change', async () => {
        binding.pending=true;generation++;
        const previous = player.deckId;
        for(const b of bindings)if(identity(b.player)===identity(player))b.select.disabled=true;
        select.disabled = true; saving++; refresh.disabled = true; archiveSave.disabled = true; updateSummary(); showSaveStatus('保存中...', 'saving');
        try {
          const data = await getJson('/api/deck-memo', {method: 'PUT', headers: {'Content-Type': 'application/json','X-Memo-Client':clientId},
            body: JSON.stringify({url: loaded.sourceUrl, memoEventId: loaded.memoEventId, ...(player.dmpId ? {dmpId: player.dmpId} : {}), participantKey: player.participantKey, deckId: select.value ? Number(select.value) : null})});
          player.deckId = data.deckId; player.deckName = data.deckName;
          for(const p of [...loaded.participants,...(loaded.rounds||[]).flatMap(r=>r.participants)])if(tcg||!player.dmpId?p.participantKey===player.participantKey:p.dmpId===player.dmpId){p.deckId=data.deckId;p.deckName=data.deckName;}
          showSaveStatus(data.deckId === null ? '解除しました' : '保存しました', data.deckId === null ? 'empty' : 'saved');
          if (loaded === current) updateSummary();
        } catch (error) {
          select.value = previous === null ? '' : String(previous);
          showSaveStatus(error.message + ' 選び直して再試行してください。', 'error');
        } finally { binding.pending=false;for(const b of bindings)if(identity(b.player)===identity(player))b.select.disabled=b.select.dataset.memoReadOnly==='true';select.disabled = false; saving--; refresh.disabled = saving > 0; updateSummary();updateBindings(binding);if(syncAgain){syncAgain=false;queueSync();} }
      });
      cell.append(select, saved); row.appendChild(cell); destination.appendChild(row);
    }
    updateSummary();
  }
  async function load() {
    if (refresh.disabled || saving || archiveBusy || pairingBusy) return;
    refresh.disabled = true; input.disabled = true; dmpInput.disabled = true; archiveSaveStatus.textContent = '';
    list.replaceChildren(); current = null;closeStream();own.hidden=true;displayRound=null;setTcgSettings();updateRoundOptions(); updateSummary();
    status.textContent = '最新の対戦表を取得中...';
    try {
      const [matching, decks] = await Promise.all([
        getJson('/api/deck-memo/matching', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({url: input.value.trim(), ...(dmpInput.value.trim() ? {detailUrl:dmpInput.value.trim()} : {})})}),
        getJson('/api/decks?sort=usage', {cache: 'no-store'})
      ]);
      const rawPlayers=Array.isArray(matching.participants)?matching.participants:[];
      matchingDiagnostic={receivedAt:new Date().toISOString(),provider:matching.provider,
        latestRound:matching.latestRound,reportedCount:matching.participantCount,
        rawCount:rawPlayers.length,server:matching.countDiagnostic||null,
        roundCounts:rawPlayers.reduce((counts,p)=>{const key=String(p.round??'missing');counts[key]=(counts[key]||0)+1;return counts;},{}),
        blankNames:rawPlayers.filter(p=>!String(p.name??p.handleName??'').trim()).length};
      deckCatalog=decks.decks;displayRound=matching.latestRound;
      current = normalizeMemoMatching(matching);
      updateRoundOptions();
      matchingDiagnostic.normalizedCount=current.participants.length;
      render(decks.decks);connectStream();
      status.textContent = matching.latestRound === null ? '現在、対戦表は公開されていません' : '最新の対戦表を取得しました。';
      if (matching.warning) status.textContent += ' ' + matching.warning;
    } catch (error) { status.textContent = error.message; }
    finally { refresh.disabled = false; input.disabled = false; dmpInput.disabled = false; }
  }
  function setTcgSettings(settings={}){settings=settings||{};document.getElementById('matching-tcg-rounds').value=settings.finalRound??'';document.getElementById('matching-tcg-zero').checked=settings.initialScore===0;document.getElementById('matching-tcg-double-loss').checked=settings.zeroGainOutcome==='double_loss';}
  function updateRoundOptions(){
    roundSelect.replaceChildren();
    for(const round of current?.rounds||[{round:current?.latestRound}]){const option=document.createElement('option');option.value=String(round.round??'');option.textContent=round.round?'Round '+round.round+(round.round===current?.latestRound?'（最新）':''):'最新ラウンド';roundSelect.append(option);}
    roundSelect.value=String(displayRound??'');
  }
  roundSelect.addEventListener('change',()=>{if(saving||archiveBusy||pairingBusy){roundSelect.value=String(displayRound??'');return;}displayRound=Number(roundSelect.value);render(deckCatalog);connectStream();});
  if(typeof window!=='undefined')window.getMemoMatchingContext=()=>current?{provider:current.provider,url:current.sourceUrl,shopId:current.event?.shopId,eventId:current.event?.eventId,seq:current.event?.held??current.event?.seq,archiveId:current.archiveId,displayRound,busy:saving>0||archiveBusy||refresh.disabled}:null;
  document.addEventListener('memo-open-matching-archive',event=>{
    if(saving||archiveBusy||refresh.disabled)return;
    current=event.detail.matching;deckCatalog=event.detail.decks;displayRound=current.rounds.some(r=>r.round===event.detail.displayRound)?event.detail.displayRound:current.latestRound;setTcgSettings(current.tcgSettings);
    input.value=current.sourceUrl;dmpInput.value='https://www.dmp-ranking.com/event.asp?'+new URLSearchParams({ShopID:current.event.shopId,EventID:current.event.eventId,Seq:current.event.held});
    updateRoundOptions();render(deckCatalog);connectStream();status.textContent='保存済み対戦表を表示しています。'+(!current.memoEventId?' 元のデッキメモがないため、デッキは参照のみです。':'');
  });
  document.addEventListener('matching-archive-deleted',event=>{if(current?.archiveId!==event.detail.archiveId)return;current=null;displayRound=null;list.replaceChildren();selects=[];updateRoundOptions();updateSummary();status.textContent='保存済み対戦表を削除しました。デッキメモは保持しています。';});
  document.addEventListener('matching-operation-busy',event=>{pairingBusy=event.detail;refresh.disabled=pairingBusy||saving>0;input.disabled=pairingBusy;dmpInput.disabled=pairingBusy;for(const select of selects)select.disabled=pairingBusy||saving>0||select.dataset.memoReadOnly==='true';updateSummary();});
  let detailRequest = 0;
  async function openArchive(id) {
    const request = ++detailRequest;
    openedArchive = null; resetArchive.disabled = true;
    const panel = document.getElementById('memo-archive-detail');
    const title = document.getElementById('memo-archive-title');
    const info = document.getElementById('memo-archive-info');
    const players = document.getElementById('memo-archive-players');
    panel.hidden = false; title.textContent = '保存済み大会'; info.textContent = '読み込み中...'; players.replaceChildren();
    try {
      const data = await getJson('/api/deck-memo/archives/' + id, {cache:'no-store'});
      if (request !== detailRequest) return;
      openedArchive = data.event; resetArchive.disabled = false;
      title.textContent = data.event.eventName;
      info.textContent = data.event.eventDate + ' ／ 参加者：' + data.participantCount + '人 ／ デッキ登録：' + data.registeredCount +
        ' / ' + data.participantCount + ' ／ 未登録：' + (data.participantCount - data.registeredCount) +
        (data.event.provider === 'tcg_meister' ? '人 ／ TCGマイスター tid：' : '人 ／ admin：') + data.event.adminKey;
      const tcg = data.event.provider === 'tcg_meister';
      const head = document.getElementById('memo-archive-head'); head.replaceChildren();
      for (const label of tcg ? ['保存時のハンドルネーム','使用デッキ'] : ['DMP ID','保存時のハンドルネーム','使用デッキ']) {
        const th = document.createElement('th'); th.textContent = label; head.appendChild(th);
      }
      for (const player of data.participants) {
        const row = document.createElement('tr');
        const values = tcg ? [player.name, player.deckName || '未選択'] : [player.dmpId, player.name, player.deckName || '未選択'];
        for (const value of values) {
          const cell = document.createElement('td'); cell.textContent = value; row.appendChild(cell);
        }
        players.appendChild(row);
      }
    } catch (error) { if (request === detailRequest) info.textContent = error.message; }
  }
  const archivePager=new SavedListPager(document.getElementById('memo-archives-list'),'保存済みデッキメモ');
  let listRequest = 0;
  async function loadArchives() {
    const request = ++listRequest;
    const state = document.getElementById('memo-archives-status');
    state.textContent = '読み込み中...';
    try {
      const data = await getJson('/api/deck-memo/archives', {cache:'no-store'});
      if (request !== listRequest) return;
      state.textContent = data.events.length ? '保存済み：' + data.events.length + '大会' : '保存済み大会はありません。';
      archivePager.update(data.events,event=>{
        const row=document.createElement('div');row.className='saved-memo-row';
        const button=document.createElement('button');button.type='button';button.className='player-detail-link';
        const name=document.createElement('strong');name.textContent=event.event_name;
        const meta=document.createElement('span');meta.textContent=`${event.event_date||'日付不明'} ／ デッキ登録 ${event.registered_count} / ${event.participant_count}人`;
        button.append(name,meta);button.addEventListener('click',()=>openArchive(event.id));row.append(button);return row;
      },'保存済み大会はありません。');
    } catch (error) { if (request === listRequest) state.textContent = error.message; }
  }
  archiveSave.addEventListener('click', async () => {
    if (archiveSave.disabled || saving || archiveBusy || !current) return;
    archiveBusy = true; archiveSave.disabled = true; refresh.disabled = true; updateSummary();
    selects.forEach(select => { select.disabled = true; });
    archiveSaveStatus.textContent = '大会デッキメモを保存中...';
    try {
      const data = await getJson('/api/deck-memo/archives', {method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({memoEventId:current.memoEventId})});
      archiveSaveStatus.textContent = '大会デッキメモを保存しました。';
      await Promise.all([loadArchives(), openArchive(data.archiveId)]);
    } catch (error) { archiveSaveStatus.textContent = error.message; }
    finally {
      archiveBusy = false; refresh.disabled = false; selects.forEach(select => {select.disabled = select.dataset.memoReadOnly==='true';}); updateSummary();
    }
  });
  async function applyProvisional(archiveId) {
    const saved = await getJson('/api/deck-memo/archives/' + archiveId);
    const event = saved.event;
    if(!event.shopId || !event.eventId || !event.seq)throw new Error('大会キーが未確定です。DMP大会URLを入力して再取得してください。');
    if(!confirm(`${event.eventName}（${event.eventDate}）\nShopID：${event.shopId} / EventID：${event.eventId} / Seq：${event.seq}\n保存済み ${saved.participantCount}人を仮反映します。正式参加人数ではありません。よろしいですか？`))return;
    const result = await getJson('/api/deck-memo/provisional-results', {method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({archiveId,shopId:event.shopId,eventId:event.eventId,seq:event.seq,confirmed:true})});
    document.getElementById('memo-provisional-status').textContent = `仮反映しました：${result.count}人。大会結果ページで同じ大会URLを入力してください。`;
  }
  async function provisionalAction(fromLive) {
    if(archiveBusy || saving || pairingBusy)return;
    archiveBusy=true; updateSummary();
    try {
      let id=openedArchive?.id;
      if(fromLive) {
        if(!current?.event)throw new Error('DMP大会URLを入力して大会情報を取得してください。');
        const saved=await getJson('/api/deck-memo/archives',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({memoEventId:current.memoEventId})});
        id=saved.archiveId; await loadArchives();
      }
      if(!id)throw new Error('保存済みメモを開いてください。');
      await applyProvisional(id);
    }catch(error){document.getElementById('memo-provisional-status').textContent=error.message;}
    finally{archiveBusy=false;updateSummary();}
  }
  document.getElementById('memo-provisional-apply').addEventListener('click',()=>provisionalAction(true));
  document.getElementById('memo-archive-provisional').addEventListener('click',()=>provisionalAction(false));
  resetArchive.addEventListener('click', async () => {
    if (!openedArchive || archiveBusy || saving || refresh.disabled) return;
    const target = openedArchive;
    const label = target.eventDate + '「' + target.eventName + '」';
    if (!confirm(label + 'のデッキメモをリセットしますか？\n保存済みメモと、このDMP大会に紐付いた入力中メモ・取得済み参加者を削除します。')) return;
    if (!confirm('最終確認：' + label + '\nこの操作は元に戻せません。大会結果・順位・確定した使用デッキ履歴は残ります。\n本当に削除しますか？')) return;
    archiveBusy = true; resetArchive.disabled = true; refresh.disabled = true; archiveSave.disabled = true;
    selects.forEach(select => { select.disabled = true; });
    try {
      const result = await getJson('/api/deck-memo/archives/' + target.id + '/reset', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({confirmed:true,eventName:target.eventName})
      });
      if (current && result.memoEventIds.includes(current.memoEventId)) {
        current = null; list.replaceChildren(); selects = [];
        status.textContent = 'メモをリセットしました。必要なら大会情報・対戦表を取得し直してください。';
      }
      ++detailRequest; openedArchive = null;
      document.getElementById('memo-archive-detail').hidden = true;
      document.getElementById('memo-archive-players').replaceChildren();
      archiveSaveStatus.textContent = label + 'のメモをリセットしました。';
      await loadArchives();
    } catch (error) {
      document.getElementById('memo-archive-info').textContent = error.message;
    } finally {
      archiveBusy = false; refresh.disabled = false; resetArchive.disabled = !openedArchive;
      selects.forEach(select => { select.disabled = select.dataset.memoReadOnly==='true'; }); updateSummary();
    }
  });
  document.getElementById('memo-archives-reload').addEventListener('click', loadArchives);
  refresh.addEventListener('click', load);
  input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); void load(); } });
})();
