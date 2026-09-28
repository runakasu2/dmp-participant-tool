let memoImportTarget = null;
let memoImportVersion = 0;
let memoImportPreview = null;
const memoImportPanel = document.getElementById('memo-import');
const memoImportStatus = document.getElementById('memo-import-status');
const memoImportOpen = document.getElementById('memo-import-open');
const memoImportDetails = document.getElementById('memo-import-details');
const memoImportCounts = document.getElementById('memo-import-counts');
const memoImportRows = document.getElementById('memo-import-rows');
const memoImportApply = document.getElementById('memo-import-apply');
const memoImportCancel = document.getElementById('memo-import-cancel');
let memoImportChoices = new Map();

async function memoImportRequest(path, body) {
  const response = await fetch(path, {method:'POST', headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const result = await response.json();
  if(!response.ok) throw new Error(result.error || 'メモ反映処理に失敗しました。');
  return result;
}

async function setMemoImportTarget(key, inputs = new Map()) {
  const version = ++memoImportVersion;
  memoImportTarget = key ? {key,inputs} : null;
  memoImportPreview = null; memoImportDetails.hidden = true; memoImportOpen.disabled = true;
  memoImportPanel.hidden = !key;
  if(!key) return;
  memoImportStatus.textContent = '保存済みデッキメモを確認中...';
  try {
    const data = await memoImportRequest('/api/deck-memo/import-preview',key);
    if(version !== memoImportVersion) return;
    memoImportPanel.hidden = !data.archive;
    if(data.archive) {
      memoImportStatus.textContent = '保存済みデッキメモがあります。デッキメモ：' + data.archive.registeredCount + ' / ' + data.archive.participantCount + '人登録済み';
      memoImportOpen.disabled = false;
    }
  } catch(error) { if(version===memoImportVersion) {memoImportStatus.textContent=error.message;memoImportOpen.disabled=false;} }
}

memoImportOpen.addEventListener('click',async()=>{
  if(!memoImportTarget) return;
  const target = memoImportTarget, version = memoImportVersion;
  memoImportOpen.disabled = true; memoImportPreview = null; memoImportDetails.hidden = true;
  try {
    const data = await memoImportRequest('/api/deck-memo/import-preview',target.key);
    if(version!==memoImportVersion) return;
    if(!data.archive) {memoImportStatus.textContent='保存済みデッキメモがありません。';return;}
    memoImportPreview=data; memoImportChoices=new Map(); memoImportRows.replaceChildren();
    const labels={new:'新規登録',same:'既存と同一',conflict:'競合',unselected:'デッキ未選択',absent:'大会結果に存在しない'};
    memoImportCounts.textContent=Object.entries(labels).map(([key,label])=>label+'：'+data.counts[key]+'件').join(' ／ ');
    for(const player of data.players) {
      const row=document.createElement('tr');
      for(const value of [labels[player.category],player.dmpId,player.name,player.currentDeckName || '未登録',player.memoDeckName || '未選択']) {
        const cell=document.createElement('td');cell.textContent=value;row.appendChild(cell);
      }
      const action=document.createElement('td');
      if(player.category==='conflict') {
        const select=document.createElement('select');select.setAttribute('aria-label',player.name+'の競合処理');
        for(const [value,label] of [['keep','既存を維持'],['overwrite','メモで上書き']]) {
          const option=document.createElement('option');option.value=value;option.textContent=label;select.appendChild(option);
        }
        select.value='keep';action.appendChild(select);memoImportChoices.set(player.dmpId,select);
      } else action.textContent=player.category==='new'?'登録する':'変更なし';
      row.appendChild(action);memoImportRows.appendChild(row);
    }
    memoImportApply.disabled=!(data.counts.new || data.counts.conflict);
    memoImportDetails.hidden=false;
  } catch(error) {if(version===memoImportVersion)memoImportStatus.textContent=error.message;}
  finally {if(version===memoImportVersion)memoImportOpen.disabled=false;}
});
memoImportCancel.addEventListener('click',()=>{memoImportPreview=null;memoImportDetails.hidden=true;});
memoImportApply.addEventListener('click',async()=>{
  if(!memoImportTarget || !memoImportPreview || memoImportApply.disabled) return;
  const target=memoImportTarget, preview=memoImportPreview;
  // Disable individual saves and event switching while the atomic import is running.
  const controls=[...document.querySelectorAll('#result-list input, #result-list button'),
    document.getElementById('get-result'),document.getElementById('result-reset'),memoImportOpen,memoImportApply,memoImportCancel,
    ...memoImportChoices.values()];
  const states=controls.map(control=>control.disabled);
  const overwriteDmpIds=[...memoImportChoices].filter(([,select])=>select.value==='overwrite').map(([id])=>id);
  controls.forEach(control=>{control.disabled=true;});
  memoImportStatus.textContent='反映中...';
  try {
    const result=await memoImportRequest('/api/deck-memo/import',{...target.key,archiveId:preview.archive.id,token:preview.token,overwriteDmpIds});
    for(const change of result.changes) {
      const input=target.inputs.get(String(change.dmpId));if(input) input.value=change.deckName;
    }
    memoImportStatus.textContent='反映しました。新規：'+result.insertedCount+'件 ／ 上書き：'+result.updatedCount+'件';
  } catch(error) {memoImportStatus.textContent=error.message;}
  finally {
    memoImportPreview=null;memoImportDetails.hidden=true;
    controls.forEach((control,index)=>{control.disabled=states[index];});
  }
});
