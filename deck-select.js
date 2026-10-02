const DECK_FORMAT_LABELS = {original:'オリジナル',advance:'アドバンス','2block':'2ブロック'};
function deckCandidates(decks, format) {
  return DECK_FORMAT_LABELS[format] ? decks.filter(deck=>(deck.formats || []).includes(format)) : decks;
}
function createFormatChoices(selected) {
  const group=document.createElement('fieldset');
  const title=document.createElement('legend');title.textContent='対応フォーマット（1つ以上）';group.appendChild(title);
  const inputs=[];
  for(const [value,name] of Object.entries(DECK_FORMAT_LABELS)) {
    const label=document.createElement('label'),input=document.createElement('input');
    input.type='checkbox';input.value=value;input.checked=selected.includes(value);
    label.append(input,document.createTextNode(name));group.appendChild(label);inputs.push(input);
  }
  group.className='deck-format-choices';group.selectedFormats=()=>inputs.filter(input=>input.checked).map(input=>input.value);
  return group;
}
function createDeckSelect(decks, {deckId = null, deckName = null, label = '使用デッキ', format = null} = {}) {
  const select = document.createElement('select');
  select.className = 'deck-select';
  select.setAttribute('aria-label', label);
  let available = [];
  select.setDeckOptions = options => {
    const previous = select.value;
    available = options;
    options = deckCandidates(options, format);
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
    const old=Array.from(select.children).find(option=>option.outsideFormat);
    if(old)old.remove();
    if(deck && !deckCandidates(available,format).includes(deck)) {
      const option=document.createElement('option');option.value=String(deck.id);
      option.textContent=deck.name+'（現在はこのフォーマットの候補外）';option.outsideFormat=true;select.appendChild(option);
    }
    select.value = deck ? String(deck.id) : '';
    select.unmatchedDeckName = !deck && name ? name : null;
    if (deck && id != null && name) {
      const option = Array.from(select.children).find(option => option.value === String(deck.id));
      if (option && !option.outsideFormat) option.textContent = name;
    }
    select.onSavedDeck?.();
  };
  select.setDeckOptions(decks);
  select.setSavedDeck(deckId, deckName);
  return select;
}
if (typeof module !== 'undefined' && module.exports) module.exports = {createDeckSelect,deckCandidates};
