function resultEventKey(input) {
  const url=new URL(input);
  if(!['http:','https:'].includes(url.protocol)||!/^(www\.)?dmp-ranking\.com$/i.test(url.hostname)||url.pathname!=='/event.asp')throw Error('DMP大会詳細URLを入力してください。');
  const values=[['ShopID','shop'],['EventID','event'],['Seq','held']].map(([key,alias])=>url.searchParams.get(key)||url.searchParams.get(alias));
  if(values.some(v=>!v))throw Error('大会URLにはShopID・EventID・Seqが必要です。');
  return {shopId:values[0],eventId:values[1],seq:values[2]};
}
async function fetchResultsView(input) {
  const key=resultEventKey(input);
  let official,officialError;
  try {
    const response=await fetch('/api/event-result-from-detail',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({detailUrl:input})});
    const body=await response.json();
    if(!response.ok)throw Error(body.detail||body.error||'公式結果を取得できませんでした。');
    official=body;
  }catch(error){officialError=error;}
  try {
  const response=await fetch('/api/event-results-view?'+new URLSearchParams(key));
  const stored=await response.json();
  if(response.ok&&Array.isArray(stored.participants)) {
    stored.officialFetchWarning=officialError?'公式サイトの取得に失敗しました。保存済み情報を表示しています。公開状況は未確認です。':official?.participants?.length===0&&stored.resultKind==='provisional'?'公式結果は取得時点で未公開です。仮登録データを表示しています。':'';
    return stored;
  }
  } catch(error) { if(!official)throw error; }
  if(official)return {...official,resultKind:'official'};
  throw officialError||Error(stored.error);
}
// Reuse prediction aggregation's canonical-name/alias rules and the existing deck catalog.
function buildResultsDistributionItems(participants, decks = []) {
  const summary = buildPredictionSummary(participants.map(player => ({prediction:{finalDeckName:player.deckName}})), decks);
  return summary.decks.filter(item => item.count > 0).map(item => item.unknown ? item :
    {...item, image_url:decks.find(deck => deck.name === item.deckName)?.image_url});
}
function renderResultsDistribution(data) {
  const host=document.getElementById('results-distribution');
  host.hidden=false;
  document.getElementById('result-kind').textContent=data.resultKind==='provisional'?'大会結果（仮登録）・公式順位未登録':'大会結果（公式結果）';
  document.getElementById('result-kind').dataset.kind=data.resultKind;
  const total=data.participants.length;
  const items=buildResultsDistributionItems(data.participants, data.deckCatalog || []);
  const known=data.participants.filter(p=>p.deckName).length;
  document.getElementById('results-distribution-count').textContent=
    `${data.resultKind==='provisional'?'仮登録':'公式結果'}：${total}人 ／ デッキ判明：${known}人 ／ 不明：${total-known}人。割合の分母：${total}人（${data.resultKind==='provisional'?'仮登録済みユニークプレイヤー数。正式参加人数ではありません':'公式結果の参加者数'}）。`;
  document.getElementById('result-source-warning').textContent=data.officialFetchWarning||
    (data.resultKind==='provisional'?'取得した公式順位はありません。仮登録データを表示しています。':'');
  const list=document.getElementById('results-distribution-rows');list.replaceChildren();
  for(const item of items){const row=document.createElement('tr');for(const value of [item.deckName,item.count+'人',item.percentage+'%']){const cell=document.createElement('td');cell.textContent=value;row.append(cell);}list.append(row);}
  renderDeckPieChart(document.getElementById('results-distribution-pie'),items,{total,minIndividualCount:1});
}
