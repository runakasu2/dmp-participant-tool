function createEventResetControls(reload) {
  const reset=document.getElementById('reset-selected-events');
  const all=document.getElementById('select-all-events');
  const clear=document.getElementById('clear-event-selection');
  const status=document.getElementById('event-reset-status');
  const refresh=document.getElementById('reload-events');
  const enter=document.getElementById('enter-event-delete');
  const cancel=document.getElementById('cancel-event-delete');
  const selection=document.getElementById('event-delete-selection');
  const heading=document.getElementById('event-selection-heading');
  const rows=new Map();let busy=false,loading=false,deleting=false;
  function update() {
    const selected=[...rows.values()].filter(p=>p.checkbox.checked).length;
    reset.disabled=!deleting||busy||loading||!selected;all.disabled=busy||loading||!rows.size;clear.disabled=busy||loading||!selected;
    refresh.disabled=busy||loading;
    enter.hidden=deleting;enter.disabled=busy||loading||!rows.size;
    selection.hidden=!deleting;heading.hidden=!deleting;cancel.disabled=busy||loading;
    for(const {checkbox,cell,row} of rows.values()) {
      checkbox.disabled=busy||loading||!deleting;cell.hidden=!deleting;
      if(row)row.title=deleting?'クリックして削除対象を選択・解除':'クリックしてデッキ母数を表示';
    }
    document.getElementById('event-selection-count').textContent='選択中：'+selected+'件';
  }
  function exitMode() {
    deleting=false;for(const p of rows.values())p.checkbox.checked=false;update();
  }
  enter.addEventListener('click',()=>{if(busy||loading||!rows.size)return;deleting=true;status.textContent='';update();});
  cancel.addEventListener('click',()=>{if(busy||loading||!deleting)return;exitMode();status.textContent='';});
  all.addEventListener('click',()=>{if(busy||loading||!deleting)return;for(const p of rows.values())p.checkbox.checked=true;update();});
  clear.addEventListener('click',()=>{if(busy||loading||!deleting)return;for(const p of rows.values())p.checkbox.checked=false;update();});
  reset.addEventListener('click',async()=>{
    if(reset.disabled||busy||loading||!deleting)return;
    const selected=[...rows.values()].filter(p=>p.checkbox.checked);
    const labels=selected.map(p=>(p.event.event_date?String(p.event.event_date).slice(0,10):'日付未取得')+' '+(p.event.event_name||'大会名未取得')+
      ' ['+p.event.shop_id+'/'+p.event.event_id+'/'+p.event.seq+']').join('\n');
    if(!confirm('選択した'+selected.length+'大会を削除しますか？\n\n'+labels+'\n\n大会結果、デッキ記録、予測、デッキメモなど、選択した大会に紐づくデータが削除されます。'))return;
    if(!confirm('最終確認\n\nこの操作は元に戻せません。\n本当に選択した'+selected.length+'大会を完全に削除しますか？\n\n'+labels))return;
    busy=true;update();status.textContent='削除中...';
    try {
      const response=await fetch('/api/events/reset',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({eventIds:selected.map(p=>p.event.id),confirmed:true})});
      const data=await response.json();
      if(!response.ok||!data.success)throw new Error(data.error||'大会の削除に失敗しました。');
      exitMode();
      status.textContent=data.deletedEventCount+'大会を削除しました。';
      await reload(true);
    } catch(error){status.textContent=error.message;}
    finally {busy=false;update();}
  });
  update();
  return {
    get busy(){return busy;},
    beginLoad(){loading=true;exitMode();rows.clear();update();},
    endLoad(){loading=false;update();},
    rowClick(id) {
      if(busy||loading)return true;
      if(!deleting)return false;
      const player=rows.get(id);
      if(player){player.checkbox.checked=!player.checkbox.checked;update();}
      return true;
    },
    cell(event,row) {
      const cell=document.createElement('td');cell.className='event-selection-cell';
      cell.addEventListener('click',e=>e.stopPropagation());
      const checkbox=document.createElement('input');checkbox.type='checkbox';
      checkbox.setAttribute('aria-label',(event.event_name||'大会')+'を選択');
      checkbox.addEventListener('change',update);cell.appendChild(checkbox);
      rows.set(event.id,{event,checkbox,cell,row});update();return cell;
    }
  };
}
