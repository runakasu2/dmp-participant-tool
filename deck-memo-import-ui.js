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
let memoImportMappings = new Map();

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

function renderMemoImportPreview(data) {
    memoImportPreview=data; memoImportMappings=new Map(); memoImportChoices=new Map(); memoImportRows.replaceChildren();
    const labels={new:'新規登録',same:'既存と同一',conflict:'競合',unselected:'デッキ未選択',absent:'大会結果に存在しない',unmatched:'DMPプレイヤー未対応'};
    memoImportCounts.textContent=Object.entries(labels).map(([key,label])=>label+'：'+(data.counts[key] || 0)+'件').join(' ／ ');
    for(const player of data.players) {
      const row=document.createElement('tr');
      for(const value of [labels[player.category],player.dmpId,player.memoName ? 'TCG：'+player.memoName+(player.dmpId ? ' ／ DMP：'+player.name : '') : player.name,player.currentDeckName || '未登録',player.memoDeckName || '未選択']) {
        const cell=document.createElement('td');cell.textContent=value;row.appendChild(cell);
      }
      if(data.archive.provider==='tcg_meister') {
        const state=document.createElement('small');
        state.textContent=' ／ '+({matched:'HN一致',manual:'手動対応',ambiguous:'同名複数・要選択',unmatched:'HN一致なし'}[player.matchStatus] || 'HN一致なし');
        row.children[0].appendChild(state);
        if(player.canMap) {
          const cell=row.children[1];cell.textContent='';
          const select=document.createElement('select');select.setAttribute('aria-label',player.memoName+'の対応する大会結果プレイヤー');
          const empty=document.createElement('option');empty.value='';empty.textContent='未選択';select.appendChild(empty);
          for(const candidate of data.dmpCandidates) {
            const option=document.createElement('option');option.value=candidate.dmpId;option.textContent=candidate.dmpId+' '+candidate.name;select.appendChild(option);
          }
          select.value=player.dmpId || '';cell.appendChild(select);
          memoImportMappings.set(player.participantKey,select);
          select.addEventListener('change',()=>updateMemoImportMapping(player,select));
        }
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
}

async function updateMemoImportMapping(player, select) {
  const target=memoImportTarget, version=memoImportVersion, preview=memoImportPreview;
  if(!target || !preview) return;
  const mappings=new Map((preview.manualMappings || []).map(p=>[p.participantKey,p.dmpId]));
  if(select.value) mappings.set(player.participantKey,select.value); else mappings.delete(player.participantKey);
  const controls=[memoImportOpen,memoImportApply,memoImportCancel,...memoImportMappings.values(),...memoImportChoices.values()];
  const states=controls.map(c=>c.disabled);controls.forEach(c=>{c.disabled=true;});
  memoImportStatus.textContent='対応先と競合を確認中...';
  let updated=false;
  try {
    const data=await memoImportRequest('/api/deck-memo/import-preview',{...target.key,
      manualMappings:[...mappings].map(([participantKey,dmpId])=>({participantKey,dmpId}))});
    if(version!==memoImportVersion) return;
    if(!data.archive || data.archive.id!==preview.archive.id) throw new Error('保存済みメモが変更されています。プレビューを開き直してください。');
    renderMemoImportPreview(data); updated=true;
    memoImportStatus.textContent='対応先を更新しました。登録内容・競合を確認してから反映してください。';
  } catch(error) {
    if(version===memoImportVersion) {select.value=player.dmpId || '';memoImportStatus.textContent=error.message;}
  } finally {
    if(version===memoImportVersion) {
      controls.forEach((c,i)=>{if(!updated || c!==memoImportApply)c.disabled=states[i];});
    }
  }
}

memoImportOpen.addEventListener('click',async()=>{
  if(!memoImportTarget) return;
  const target = memoImportTarget, version = memoImportVersion;
  memoImportOpen.disabled = true; memoImportPreview = null; memoImportDetails.hidden = true;
  try {
    const data = await memoImportRequest('/api/deck-memo/import-preview',target.key);
    if(version!==memoImportVersion) return;
    if(!data.archive) {memoImportStatus.textContent='保存済みデッキメモがありません。';return;}
    renderMemoImportPreview(data);
  } catch(error) {if(version===memoImportVersion)memoImportStatus.textContent=error.message;}
  finally {if(version===memoImportVersion)memoImportOpen.disabled=false;}
});
memoImportCancel.addEventListener('click',()=>{memoImportPreview=null;memoImportDetails.hidden=true;});
memoImportApply.addEventListener('click',async()=>{
  if(!memoImportTarget || !memoImportPreview || memoImportApply.disabled) return;
  const target=memoImportTarget, preview=memoImportPreview;
  // Disable individual saves and event switching while the atomic import is running.
  const controls=[...document.querySelectorAll('#result-list input, #result-list select, #result-list button'),
    document.getElementById('get-result'),document.getElementById('result-reset'),memoImportOpen,memoImportApply,memoImportCancel,
    ...memoImportChoices.values(),...memoImportMappings.values()];
  const states=controls.map(control=>control.disabled);
  const overwriteDmpIds=[...memoImportChoices].filter(([,select])=>select.value==='overwrite').map(([id])=>id);
  controls.forEach(control=>{control.disabled=true;});
  memoImportStatus.textContent='反映中...';
  try {
    const result=await memoImportRequest('/api/deck-memo/import',{...target.key,archiveId:preview.archive.id,token:preview.token,overwriteDmpIds,...(preview.manualMappings ? {manualMappings:preview.manualMappings} : {})});
    if (result.decks) {
      for (const input of target.inputs.values()) input.setDeckOptions?.(result.decks);
    }
    for(const change of result.changes) {
      const input=target.inputs.get(String(change.dmpId));
      if(input?.setSavedDeck) input.setSavedDeck(change.deckId,change.deckName);
      else if(input) input.value=change.deckName;
    }
    memoImportStatus.textContent='反映しました。新規：'+result.insertedCount+'件 ／ 上書き：'+result.updatedCount+'件';
  } catch(error) {memoImportStatus.textContent=error.message;}
  finally {
    memoImportPreview=null;memoImportDetails.hidden=true;
    controls.forEach((control,index)=>{control.disabled=states[index];});
  }
});
