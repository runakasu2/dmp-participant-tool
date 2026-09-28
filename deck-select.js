function createDeckSelect(decks, {deckId = null, deckName = null, label = '使用デッキ'} = {}) {
  const select = document.createElement('select');
  select.className = 'deck-select';
  select.setAttribute('aria-label', label);
  let available = [];
  select.setDeckOptions = options => {
    const previous = select.value;
    available = options;
    select.replaceChildren();
    for (const deck of [{id:'',name:'未選択'}, ...options]) {
      const option = document.createElement('option');
      option.value = String(deck.id); option.textContent = deck.name;
      select.appendChild(option);
    }
    select.value = options.some(d => String(d.id) === previous) ? previous : '';
  };
  select.setSavedDeck = (id, name) => {
    const key = name?.trim().toLowerCase();
    const deck = available.find(d => id != null && String(d.id) === String(id)) ||
      available.find(d => key && d.name.toLowerCase() === key) ||
      available.find(d => key && (d.aliases || []).some(alias => alias.toLowerCase() === key));
    select.value = deck ? String(deck.id) : '';
    select.unmatchedDeckName = !deck && name ? name : null;
    if (deck && id != null && name) {
      const option = Array.from(select.children).find(option => option.value === String(deck.id));
      if (option) option.textContent = name;
    }
    select.onSavedDeck?.();
  };
  select.setDeckOptions(decks);
  select.setSavedDeck(deckId, deckName);
  return select;
}
if (typeof module !== 'undefined' && module.exports) module.exports = {createDeckSelect};
