const rpsHandLabels = {rock: '👊 グー', scissors: '✌️ チョキ', paper: '🖐️ パー'};
function renderPlayerInsights(data) {
  const recent = document.getElementById('player-recent-decks');
  const top = document.getElementById('player-deck-summary');
  const appendRow = (list, name, value) => {
    const row = document.createElement('li');
    const label = document.createElement('span'); label.textContent = name;
    const detail = document.createElement('span'); detail.textContent = value;
    row.append(label, detail); list.append(row);
  };
  recent.replaceChildren(); top.replaceChildren();
  const history = data.recentDecks || data.history?.slice(0, 5) || [];
  const ranked = data.topDecks || data.deckSummary?.slice(0, 3) || [];
  history.forEach(item => appendRow(recent, item.deckName, item.eventDate ? item.eventDate.slice(0, 10) : '日付不明'));
  ranked.forEach((item, i) => appendRow(top, `${i + 1}. ${item.deckName}`, `${item.count}回`));
  if (!history.length) appendRow(recent, '使用デッキの記録がありません。', '');
  if (!ranked.length) appendRow(top, '使用デッキの記録がありません。', '');
  const summary = data.rpsSummary;
  const stats = document.getElementById('player-rps-stats');
  stats.replaceChildren();
  document.getElementById('player-rps-total').textContent = `${summary?.total || 0}回記録`;
  document.getElementById('player-rps-empty').hidden = Boolean(summary?.total);
  stats.hidden = !summary?.total;
  if (summary?.total) for (const hand of summary.hands) {
    const column = document.createElement('div');
    const name = document.createElement('span'); name.textContent = rpsHandLabels[hand.hand];
    const rate = document.createElement('strong'); rate.textContent = `${hand.percentage}%`;
    const count = document.createElement('small'); count.textContent = `${hand.count}回`;
    column.append(name, rate, count); stats.append(column);
  }
  const predictions = document.getElementById('player-rps-tie-predictions');
  predictions.replaceChildren();
  for (const stage of data.rpsTiePredictions?.stages || [1,2,3].map(n=>({afterTies:n,nextRound:n+1,samples:0,hands:[],predictedHands:[]}))) {
    const panel=document.createElement('article');panel.className='rps-tie-stage';
    const title=document.createElement('h3');title.textContent=`${stage.afterTies}回あいこ後、${stage.nextRound}回目の手`;panel.append(title);
    const prediction=document.createElement('p');const first=stage.hands.find(hand=>stage.predictedHands.includes(hand.hand));
    prediction.textContent=stage.samples?`最多：${stage.predictedHands.map(hand=>rpsHandLabels[hand]).join('・')} ／ ${first?.percentage}%（サンプル ${stage.samples}件）`:'データなし（サンプル 0件）';panel.append(prediction);
    if(stage.samples){const distribution=document.createElement('div');distribution.className='rps-stats';for(const hand of stage.hands){const item=document.createElement('div');item.textContent=`${rpsHandLabels[hand.hand]} ${hand.count}回 ／ ${hand.percentage}%`;distribution.append(item);}panel.append(distribution);}predictions.append(panel);
  }
}

(() => {
  const form = document.getElementById('rps-form');
  const name = document.getElementById('rps-player-name');
  const hand = document.getElementById('rps-hand');
  const candidates = document.getElementById('rps-candidates');
  const status = document.getElementById('rps-status');
  const selectedLabel = document.getElementById('rps-selected');
  const search = document.getElementById('rps-search');
  const view = document.getElementById('rps-view-player');
  const ties=document.getElementById('rps-ties'),historyList=document.getElementById('rps-history-list'),historyStatus=document.getElementById('rps-history-status');
  let selected = null, searchVersion = 0, saving = false, editing=null, historyVersion=0, historyPage=1;
  function renumberTies(){[...ties.children].forEach((row,i)=>{row.querySelector('label').textContent=`${i+1}回目のあいこ`;row.querySelector('select').setAttribute('aria-label',`${i+1}回目のあいこ`);row.querySelector('button').setAttribute('aria-label',`${i+1}回目のあいこを削除`);});}
  function addTie(value=''){if(saving)return;const row=document.createElement('div');row.className='rps-tie-row';const label=document.createElement('label'),select=document.createElement('select');select.required=true;for(const [hand,name] of [['','選択してください'],...Object.entries(rpsHandLabels)]){const option=document.createElement('option');option.value=hand;option.textContent=name;select.append(option);}select.value=value;const remove=document.createElement('button');remove.type='button';remove.textContent='削除';remove.addEventListener('click',()=>{if(saving)return;row.remove();renumberTies();});row.append(label,select,remove);ties.append(row);renumberTies();}
  function resetEditing(){if(editing!==null)hand.value='';editing=null;ties.replaceChildren();document.getElementById('rps-editing').hidden=true;document.getElementById('rps-edit-cancel').hidden=true;document.getElementById('rps-save').textContent='記録する';}
  function clearHistory(){historyVersion++;historyList.replaceChildren();historyStatus.textContent='';document.getElementById('rps-history-pages').hidden=true;}
  document.getElementById('rps-tie-add').addEventListener('click',()=>addTie());
  document.getElementById('rps-edit-cancel').addEventListener('click',()=>{if(!saving){resetEditing();status.textContent='編集をやめました。保存内容は変更していません。';}});
  async function loadRecords(page=1,force=false){if((saving&&!force)||!selected||selected.createGuest)return;const version=++historyVersion,owner=selected;historyStatus.textContent='記録を読み込み中…';
    const query=new URLSearchParams(owner.dmpId?{dmpId:owner.dmpId}:{guestId:owner.guestId});query.set('page',page);
    try{const response=await fetch('/api/rps/records?'+query,{cache:'no-store'}),data=await response.json();if(!response.ok)throw Error(data.error||'記録を取得できませんでした。');if(version!==historyVersion||(saving&&!force))return;
      historyPage=data.page;historyList.replaceChildren();for(const record of data.records){const row=document.createElement('article');row.className='rps-history-record';const summary=document.createElement('p');summary.textContent=`${new Date(record.created_at).toLocaleString('ja-JP')} ／ あいこ：${record.ties.length?record.ties.map(hand=>rpsHandLabels[hand]).join(' → '):'記録なし'} ／ 最終：${rpsHandLabels[record.hand]}`;const edit=document.createElement('button');edit.type='button';edit.textContent='編集';edit.addEventListener('click',()=>{if(saving)return;resetEditing();editing=record.id;hand.value=record.hand;for(const value of record.ties)addTie(value);document.getElementById('rps-editing').hidden=false;document.getElementById('rps-editing').textContent=`記録 #${record.id}を編集しています（${identityLabel(owner)}）`;document.getElementById('rps-edit-cancel').hidden=false;document.getElementById('rps-save').textContent='変更を保存';status.textContent='あいこの履歴と最終の手を変更できます。';form.scrollIntoView({block:'start'});});row.append(summary,edit);historyList.append(row);}
      historyStatus.textContent=data.total?`${data.total}件の記録`:'保存済みの記録はありません。';document.getElementById('rps-history-pages').hidden=!data.total;document.getElementById('rps-history-page').textContent=`${page} / ${Math.max(1,Math.ceil(data.total/data.pageSize))}ページ`;document.getElementById('rps-history-prev').disabled=page<=1;document.getElementById('rps-history-next').disabled=page*data.pageSize>=data.total;
    }catch(error){if(version===historyVersion)historyStatus.textContent=error.message;}
  }
  document.getElementById('rps-history-load').addEventListener('click',()=>loadRecords());
  document.getElementById('rps-history-prev').addEventListener('click',()=>loadRecords(historyPage-1));document.getElementById('rps-history-next').addEventListener('click',()=>loadRecords(historyPage+1));
  document.getElementById('menu-rps').addEventListener('click', () => {
    hideAllPages(); clearActiveMenus();
    document.getElementById('page-rps').style.display = 'block';
    document.getElementById('menu-rps').classList.add('active');
  });
  const identityLabel = player => player.dmpId ? `DMP ID：${player.dmpId}`
    : player.guestId ? `DMP ID未登録・記録先 #${player.guestId}` : '新しい記録先（DMP ID未登録）';
  function choose(player) {
    resetEditing();clearHistory();document.getElementById('rps-history-load').disabled=Boolean(player.createGuest);
    searchVersion++;
    selected = player;
    name.value = player.handleName;
    candidates.replaceChildren();
    selectedLabel.dataset.selected = 'true';
    selectedLabel.textContent = `✓ 選択済み：${player.handleName} / ${identityLabel(player)}`;
    status.textContent = '登録先を選択しました。じゃんけんの手を選んで登録してください。';
    view.hidden = Boolean(player.createGuest);
    hand.focus();
  }
  name.addEventListener('input', () => {
    resetEditing();clearHistory();document.getElementById('rps-history-load').disabled=true;
    searchVersion++; selected = null; view.hidden = true;
    candidates.replaceChildren();
    delete selectedLabel.dataset.selected;
    selectedLabel.textContent = 'プレイヤーを検索して選択してください。';
    status.textContent = '';
  });
  async function searchPlayers() {
    if (saving) return;
    const query = name.value.trim();
    if (!query) { name.reportValidity(); return; }
    const version = ++searchVersion;
    candidates.replaceChildren(); status.textContent = '候補を検索中…';
    try {
      const response = await fetch('/api/player-search?includeRpsGuests=1&q=' + encodeURIComponent(query));
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '候補を検索できませんでした。');
      if (version !== searchVersion) return;
      for (const item of data.players) {
        const player = {dmpId: item.dmp_id || undefined, guestId: item.guest_id, handleName: item.handle_name};
        const button = document.createElement('button'); button.type = 'button';
        button.textContent = `${player.handleName} / ${identityLabel(player)}`;
        button.addEventListener('click', () => choose(player)); candidates.append(button);
      }
      const create = document.createElement('button'); create.type = 'button';
      create.textContent = `「${query}」で新しい記録先を作成（DMP ID未登録）`;
      create.addEventListener('click', () => choose({handleName: query, createGuest: true}));
      candidates.append(create);
      status.textContent = data.players.length ? '候補から相手を選んでください。同名でも別人の場合は新しい記録先を選べます。'
        : '候補がありません。名前を確認して新しい記録先を選んでください。';
    } catch (error) { if (version === searchVersion) status.textContent = error.message; }
  }
  search.addEventListener('click', searchPlayers);
  name.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); searchPlayers(); } });
  view.addEventListener('click', () => { if (selected) openPlayerDetail(selected.dmpId, selected.guestId); });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (saving || !form.reportValidity()) return;
    // Identity is held by ID; any user edit already clears it in the input handler.
    if (!selected) {
      status.textContent = '候補からプレイヤーを選ぶか、新しい記録先を選択してください。候補の表示だけでは選択されません。'; return;
    }
    if (!Object.hasOwn(rpsHandLabels, hand.value)) { status.textContent = 'じゃんけんの手を選択してください。'; return; }
    const wasEditing=editing, hadHistory=Boolean(historyList.children.length);
    saving = true; searchVersion++;historyVersion++;
    const controls = [...form.querySelectorAll('input,select,button')];
    controls.forEach(control => { control.disabled = true; });
    form.setAttribute('aria-busy', 'true'); status.textContent = '保存中…';
    try {
      const response = await fetch(wasEditing?'/api/rps/records/'+wasEditing:'/api/rps/records', {method: wasEditing?'PUT':'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({playerName: selected.handleName, dmpId: selected.dmpId, guestId: selected.guestId,
          createGuest: selected.createGuest, hand: hand.value, ties: [...ties.querySelectorAll('select')].map(select=>select.value)})});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'じゃんけんデータを保存できませんでした。');
      choose(data.player); hand.value = '';
      status.textContent = wasEditing?'じゃんけんデータの変更を保存しました。':'じゃんけんデータを記録しました。続けて記録する手を選んでください。';
      if(hadHistory)await loadRecords(1,true);
    } catch (error) { status.textContent = error.message; }
    finally {
      saving = false; controls.forEach(control => { control.disabled = false; });
      form.removeAttribute('aria-busy'); hand.focus();
    }
  });
})();
