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
  let selected = null, searchVersion = 0, saving = false;
  document.getElementById('menu-rps').addEventListener('click', () => {
    hideAllPages(); clearActiveMenus();
    document.getElementById('page-rps').style.display = 'block';
    document.getElementById('menu-rps').classList.add('active');
  });
  const identityLabel = player => player.dmpId ? `DMP ID：${player.dmpId}`
    : player.guestId ? `DMP ID未登録・記録先 #${player.guestId}` : '新しい記録先（DMP ID未登録）';
  function choose(player) {
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
    saving = true; searchVersion++;
    const controls = [...form.querySelectorAll('input,select,button')];
    controls.forEach(control => { control.disabled = true; });
    form.setAttribute('aria-busy', 'true'); status.textContent = '保存中…';
    try {
      const response = await fetch('/api/rps/records', {method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({playerName: selected.handleName, dmpId: selected.dmpId, guestId: selected.guestId,
          createGuest: selected.createGuest, hand: hand.value})});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'じゃんけんデータを保存できませんでした。');
      choose(data.player); hand.value = '';
      status.textContent = 'じゃんけんデータを記録しました。続けて記録する手を選んでください。';
    } catch (error) { status.textContent = error.message; }
    finally {
      saving = false; controls.forEach(control => { control.disabled = false; });
      form.removeAttribute('aria-busy'); hand.focus();
    }
  });
})();
