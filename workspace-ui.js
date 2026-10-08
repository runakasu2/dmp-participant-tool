/* Presentation only. Existing page buttons, API requests and data-owning renderers stay authoritative. */
(() => {
  const pages = [...document.querySelectorAll('.page')];
  const menu = document.querySelector('.menu');
  const more = document.getElementById('menu-more');
  const extra = document.getElementById('menu-extra');
  const mobile = window.matchMedia('(max-width: 720px)');
  const pageNames = {
    participants: '参加表明', results: '大会結果', events: '大会一覧',
    'event-detail': '大会詳細', players: 'プレイヤー検索', 'player-detail': 'プレイヤー詳細',
    rps: 'じゃんけんデータ', decks: 'デッキ管理', 'deck-memo': 'デッキメモ'
  };
  let currentPage;
  function closeMore(returnFocus = false) {
    more.setAttribute('aria-expanded', 'false');
    extra.classList.remove('is-open');
    if (returnFocus) more.focus();
  }
  more.addEventListener('click', () => {
    const open = more.getAttribute('aria-expanded') !== 'true';
    more.setAttribute('aria-expanded', String(open));
    extra.classList.toggle('is-open', open);
    if (open) extra.querySelector('button').focus();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && more.getAttribute('aria-expanded') === 'true') closeMore(true);
  });
  document.addEventListener('click', event => {
    if (!menu.contains(event.target)) closeMore();
  });
  menu.addEventListener('click', event => {
    if (event.target.closest('[aria-controls^="page-"]')) closeMore();
  });
  mobile.addEventListener('change', () => closeMore());
  function updateNavigation() {
    const page = pages.find(element => element.style.display !== 'none');
    if (!page) return;
    const key = page.id.replace('page-', '');
    const parent = {'event-detail': 'events', 'player-detail': 'players'}[key] || key;
    menu.querySelectorAll('[aria-controls^="page-"]').forEach(button => {
      const active = button.id === 'menu-' + parent;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    more.classList.toggle('has-active', ['decks', 'players', 'rps'].includes(parent));
    document.getElementById('current-page-label').textContent = pageNames[key] || '大会データ';
    if (currentPage && currentPage !== page) {
      closeMore();
      window.scrollTo({top: 0, behavior: 'instant'});
      const heading = page.querySelector('h2');
      heading?.setAttribute('tabindex', '-1');
      heading?.focus({preventScroll: true});
    }
    currentPage = page;
  }
  const navigationObserver = new MutationObserver(updateNavigation);
  pages.forEach(page => navigationObserver.observe(page, {attributes: true, attributeFilter: ['style']}));
  updateNavigation();

  const emptyMessages = {
    'participant-list': '大会URLを入力して、参加者を取得してください。',
    'result-list': '大会結果を取得すると、順位とデッキを確認できます。',
    'player-search-list': 'DMP IDまたはハンドルネームで検索してください。',
    'memo-list': '対戦表を取得すると、ここでデッキを記録できます。'
  };
  const cardLists = ['participant-list', 'result-list', 'event-results-list', 'player-search-list',
    'player-history-list', 'memo-list', 'memo-archives-list', 'memo-archive-players', 'memo-import-rows'];
  const compactLists = new Set(['participant-list', 'result-list', 'event-results-list', 'memo-archive-players']);
  function compactRow(row, id, headers) {
    if (row.cells.length < 2 || row.querySelector('[colspan]')) return;
    row.classList.add('compact-player-row');
    for (const [index,cell] of [...row.cells].entries()) {
      const label=headers[index]?.textContent.trim() || '';
      cell.classList.toggle('compact-identity', /^(ID|DMP ID)$/.test(label));
      cell.classList.toggle('compact-history', /直近/.test(label));
      cell.classList.toggle('compact-rank', /順位/.test(label));
      cell.classList.toggle('compact-deck', /デッキ/.test(label) && !/直近/.test(label));
      cell.classList.toggle('compact-action', /保存/.test(label) && !/ハンドルネーム/.test(label));
      const text=cell.querySelector('.player-detail-link') || (!cell.querySelector('select,button') ? cell : null);
      if(text && text.title !== text.textContent) text.title=text.textContent;
    }
    if (row.querySelector('.compact-toggle')) return;
    const toggle=document.createElement('button');
    toggle.type='button'; toggle.className='compact-toggle'; toggle.textContent='詳細';
    toggle.setAttribute('aria-expanded','false');
    toggle.addEventListener('click',event=>{
      event.stopPropagation();
      const expanded=row.classList.toggle('is-expanded');
      toggle.setAttribute('aria-expanded',String(expanded));
      if(!toggle.classList.contains('compact-name-toggle'))toggle.textContent=expanded?'閉じる':'詳細';
    });
    const host=id==='participant-list' ? row.querySelector('.prediction-cell') : row.querySelector('.is-player-name');
    if(host?.classList.contains('is-player-name') && !host.querySelector('.player-detail-link')) {
      const full=document.createElement('span');full.className='compact-name-text';
      full.textContent=host.textContent;
      toggle.classList.add('compact-name-toggle');
      toggle.setAttribute('aria-label',host.textContent+'の詳細を展開・折りたたみ');
      toggle.replaceChildren(full);host.replaceChildren();
    }
    host?.append(toggle);
  }
  for (const id of cardLists) {
    const body = document.getElementById(id);
    const table = body.closest('table');
    table.classList.add('responsive-cards');
    if(compactLists.has(id))table.classList.add('compact-player-table');
    // Explicit roles preserve table semantics when mobile CSS reflows rows.
    table.setAttribute('role', 'table');
    body.setAttribute('role', 'rowgroup');
    let empty;
    if (emptyMessages[id]) {
      empty = document.createElement('div');
      empty.className = 'table-empty';
      empty.textContent = emptyMessages[id];
      table.after(empty);
    }
    const update = () => {
      const headers = [...table.tHead.rows[0].cells];
      headers.forEach(header => { header.scope = 'col'; header.setAttribute('role', 'columnheader'); });
      table.tHead.setAttribute('role', 'rowgroup');
      table.tHead.rows[0].setAttribute('role', 'row');
      for (const row of body.rows) {
        row.setAttribute('role', 'row');
        [...row.cells].forEach((cell, index) => {
          const label = headers[index]?.textContent.trim() || '';
          cell.dataset.label = label;
          cell.setAttribute('role', 'cell');
          cell.classList.toggle('is-player-name', cell.colSpan === 1 && /ハンドルネーム/.test(label));
        });
        if(compactLists.has(id))compactRow(row,id,headers);
        // Rows that already have click handlers become keyboard accessible too.
        if (row.style.cursor === 'pointer' && !row.querySelector('button, a, input, select')) {
          row.tabIndex = 0;
          if (!row.dataset.keyboardReady) {
            row.dataset.keyboardReady = 'true';
            row.addEventListener('keydown', event => {
              if (event.target === row && ['Enter', ' '].includes(event.key)) {
                event.preventDefault(); row.click();
              }
            });
          }
        }
      }
      if (empty) empty.hidden = body.rows.length > 0;
    };
    new MutationObserver(update).observe(table, {childList: true, subtree: true});
    update();
  }

  // Status styling follows messages from the existing renderers; it does not change their contents.
  document.querySelectorAll('[role="status"]').forEach(status => {
    status.classList.add('ui-status');
    const update = () => {
      const text = status.textContent;
      status.dataset.tone = /失敗|エラー|できません|不正/.test(text) ? 'error'
        : /保存しました|反映しました|更新しました|記録しました/.test(text) ? 'success'
        : /取得中|保存中|読み込み中|処理中/.test(text) ? 'loading' : 'info';
    };
    new MutationObserver(update).observe(status, {childList: true, characterData: true, subtree: true});
    update();
  });
})();
