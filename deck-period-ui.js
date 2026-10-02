function createDeckPeriodControls(readFilters){
  const panel=document.getElementById('deck-period-summary'),status=document.getElementById('deck-period-status'),body=document.getElementById('deck-period-rows'),list=document.getElementById('deck-period-list'),pie=document.getElementById('deck-period-pie');
  let version=0,data=null,mode='list',pieDrawn=false;
  function renderMode(){
    list.hidden=mode!=='list';pie.hidden=mode!=='pie';
    for(const value of ['list','pie'])document.getElementById('period-'+value).setAttribute('aria-pressed',String(mode===value));
    if(mode==='pie'&&data&&data.includedEvents&&!pieDrawn){
      renderDeckPieChart(pie,[...data.decks.map(deck=>({...deck,percentage:deck.percentage.toFixed(1)})),
        {deckName:'未登録',count:data.unregistered,percentage:data.totalParticipants?(data.unregistered/data.totalParticipants*100).toFixed(1):'0.0',unknown:true}],{total:data.totalParticipants});
      pieDrawn=true;
    }
  }
  function clear(){version++;data=null;pieDrawn=false;panel.hidden=true;body.replaceChildren();pie.replaceChildren();}
  async function load(){
    let filters;try{filters=readFilters();}catch(error){clear();panel.hidden=false;status.textContent=error.message;return;}
    clear();const request=version;panel.hidden=false;mode='list';renderMode();status.textContent='期間母数を取得中...';
    try{
      const response=await fetch('/api/deck-period-summary?'+eventFilterQuery(filters),{cache:'no-store'}),result=await response.json();
      if(request!==version)return;if(!response.ok||!result.success)throw Error(result.error||'期間母数を取得できませんでした。');data=result;
      status.textContent=`${DECK_FORMAT_LABELS[data.format]} ／ ${data.startDate||'開始指定なし'} ～ ${data.endDate||'終了指定なし'}\n`+
        `期間内大会：${data.totalEvents} ／ 母数集計済み：${data.includedEvents} ／ 未集計：${data.missingEvents}\n`+
        `合計参加人数：${data.totalParticipants}人 ／ デッキ登録：${data.registeredDecks}人 ／ 未登録：${data.unregistered}人 ／ 登録率：${data.registrationPercentage.toFixed(1)}%`;
      if(!data.totalEvents){status.textContent+='\n条件に一致する大会がありません。';return;}
      if(!data.includedEvents){status.textContent+='\n対象期間に母数集計済みの大会がありません。';return;}
      const rows=[...data.decks,{deckName:'未登録',count:data.unregistered,percentage:data.totalParticipants?data.unregistered/data.totalParticipants*100:0,unknown:true}];
      rows.forEach((deck,i)=>{const row=document.createElement('tr');for(const value of [deck.unknown?'—':i+1,deck.deckName,deck.count+'人',deck.percentage.toFixed(1)+'%']){const cell=document.createElement('td');cell.textContent=value;row.appendChild(cell);}body.appendChild(row);});
      renderMode();
    }catch(error){if(request===version)status.textContent=error.message;}
  }
  document.getElementById('show-deck-period').addEventListener('click',load);
  for(const value of ['list','pie'])document.getElementById('period-'+value).addEventListener('click',()=>{mode=value;renderMode();});
  for(const id of ['events-start-date','events-end-date'])document.getElementById(id).addEventListener('input',clear);
  return {clear,load};
}
