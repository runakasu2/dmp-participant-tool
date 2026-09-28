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
  let current = null;
  let saving = 0;
  menu.addEventListener('click', () => {
    hideAllPages(); clearActiveMenus();
    page.style.display = 'block'; menu.classList.add('active');
    void loadArchives();
  });
  const updateSummary = () => {
    archiveSave.disabled = !current?.event || !current.participants.length || saving > 0 || archiveBusy;
    if (!current) { summary.textContent = ''; eventInfo.textContent = ''; return; }
    eventInfo.textContent = current.event ? '大会名：' + current.event.eventName + ' ／ 開催日：' + current.event.eventDate : '';
    summary.textContent = (current.latestRound === null ? '未公開' : '現在：Round ' + current.latestRound) +
      ' ／ 参加者：' + current.participants.length + '人 ／ デッキ登録：' +
      current.participants.filter(player => player.deckId !== null).length + ' / ' + current.participants.length +
      ' ／ admin：' + current.adminKey;
  };
  async function getJson(url, options) {
    const response = await fetch(url, options);
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || '取得・保存に失敗しました。');
    return data;
  }
  function render(decks) {
    list.replaceChildren();
    selects = [];
    let previousTable = null, group = 0;
    const loaded = current;
    for (const player of loaded.participants) {
      const row = document.createElement('tr');
      if (previousTable !== player.table) { row.classList.add('memo-table-start'); group++; }
      if (group % 2) row.classList.add('memo-table-shade');
      previousTable = player.table;
      for (const value of [player.table, player.dmpId, player.name]) {
        const cell = document.createElement('td'); cell.textContent = value; row.appendChild(cell);
      }
      const cell = document.createElement('td');
      const select = createDeckSelect(decks, {deckId:player.deckId, deckName:player.deckName, label:player.name + 'の使用デッキ'});
      selects.push(select);
      const saved = document.createElement('small'); saved.setAttribute('role', 'status');
      saved.textContent = select.unmatchedDeckName ? '保存済み：' + select.unmatchedDeckName + '（一覧を再取得してください）' : player.deckId === null ? '未登録' : '保存済み';
      select.addEventListener('change', async () => {
        const previous = player.deckId;
        select.disabled = true; saving++; refresh.disabled = true; archiveSave.disabled = true; saved.textContent = '保存中...';
        try {
          const data = await getJson('/api/deck-memo', {method: 'PUT', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({url: loaded.sourceUrl, memoEventId: loaded.memoEventId, dmpId: player.dmpId, deckId: select.value ? Number(select.value) : null})});
          player.deckId = data.deckId; player.deckName = data.deckName;
          saved.textContent = data.deckId === null ? '解除しました' : '保存しました';
          if (loaded === current) updateSummary();
        } catch (error) {
          select.value = previous === null ? '' : String(previous);
          saved.textContent = error.message + ' 選び直して再試行してください。';
        } finally { select.disabled = false; saving--; refresh.disabled = saving > 0; updateSummary(); }
      });
      cell.append(select, saved); row.appendChild(cell); list.appendChild(row);
    }
    updateSummary();
  }
  async function load() {
    if (refresh.disabled || saving || archiveBusy) return;
    refresh.disabled = true; input.disabled = true; dmpInput.disabled = true; archiveSaveStatus.textContent = '';
    list.replaceChildren(); current = null; updateSummary();
    status.textContent = '最新の対戦表を取得中...';
    try {
      const [matching, decks] = await Promise.all([
        getJson('/api/deck-memo/matching', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({url: input.value.trim(), detailUrl: dmpInput.value.trim()})}),
        getJson('/api/decks?sort=usage', {cache: 'no-store'})
      ]);
      current = matching;
      render(decks.decks);
      status.textContent = matching.latestRound === null ? '現在、対戦表は公開されていません' : '最新の対戦表を取得しました。';
      if (matching.warning) status.textContent += ' ' + matching.warning;
    } catch (error) { status.textContent = error.message; }
    finally { refresh.disabled = false; input.disabled = false; dmpInput.disabled = false; }
  }
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
        '人 ／ admin：' + data.event.adminKey;
      for (const player of data.participants) {
        const row = document.createElement('tr');
        for (const value of [player.dmpId, player.name, player.deckName || '未選択']) {
          const cell = document.createElement('td'); cell.textContent = value; row.appendChild(cell);
        }
        players.appendChild(row);
      }
    } catch (error) { if (request === detailRequest) info.textContent = error.message; }
  }
  let listRequest = 0;
  async function loadArchives() {
    const request = ++listRequest;
    const state = document.getElementById('memo-archives-status');
    const table = document.getElementById('memo-archives-list');
    state.textContent = '読み込み中...';
    try {
      const data = await getJson('/api/deck-memo/archives', {cache:'no-store'});
      if (request !== listRequest) return;
      table.replaceChildren();
      state.textContent = data.events.length ? '保存済み：' + data.events.length + '大会' : '保存済み大会はありません。';
      for (const event of data.events) {
        const row = document.createElement('tr');
        const date = document.createElement('td'); date.textContent = event.event_date;
        const name = document.createElement('td');
        const button = document.createElement('button'); button.className = 'player-detail-link'; button.textContent = event.event_name;
        button.addEventListener('click', () => openArchive(event.id)); name.appendChild(button);
        const count = document.createElement('td'); count.textContent = event.registered_count + ' / ' + event.participant_count;
        row.append(date, name, count); table.appendChild(row);
      }
    } catch (error) { if (request === listRequest) state.textContent = error.message; }
  }
  archiveSave.addEventListener('click', async () => {
    if (archiveSave.disabled || saving || archiveBusy || !current) return;
    archiveBusy = true; archiveSave.disabled = true; refresh.disabled = true;
    selects.forEach(select => { select.disabled = true; });
    archiveSaveStatus.textContent = '大会デッキメモを保存中...';
    try {
      const data = await getJson('/api/deck-memo/archives', {method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({memoEventId:current.memoEventId})});
      archiveSaveStatus.textContent = '大会デッキメモを保存しました。';
      await Promise.all([loadArchives(), openArchive(data.archiveId)]);
    } catch (error) { archiveSaveStatus.textContent = error.message; }
    finally {
      archiveBusy = false; refresh.disabled = false; selects.forEach(select => {select.disabled = false;}); updateSummary();
    }
  });
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
      selects.forEach(select => { select.disabled = false; }); updateSummary();
    }
  });
  document.getElementById('memo-archives-reload').addEventListener('click', loadArchives);
  refresh.addEventListener('click', load);
  input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); void load(); } });
})();
