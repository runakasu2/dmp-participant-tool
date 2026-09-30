function createDeckImageEditor(deck) {
  const form=document.createElement('form');form.className='deck-image-editor';
  const label=document.createElement('label');label.textContent='代表画像のHTTPS URL（空欄で解除）';
  const input=document.createElement('input');input.type='url';input.value=deck.image_url||'';input.placeholder='https://…';label.appendChild(input);
  const preview=document.createElement('img');preview.alt=deck.name+'の代表画像';preview.referrerPolicy='no-referrer';preview.loading='lazy';
  const state=document.createElement('p');state.setAttribute('role','status');
  function show(url){preview.hidden=!url;state.textContent=url?'代表画像設定済み':'画像未設定';if(url)preview.src=url;else preview.removeAttribute('src');}
  preview.addEventListener('error',()=>{preview.hidden=true;state.textContent='画像を読み込めません。URLを確認してください。';});
  const background=document.createElement('div');background.className='deck-art-preview';
  const art=document.createElement('img');art.alt='大会背景プレビュー';art.referrerPolicy='no-referrer';background.appendChild(art);attachCardArt(art,background);
  art.addEventListener('error',()=>{art.hidden=true;});
  const caption=document.createElement('p');caption.textContent='大会背景プレビュー';
  const file=document.createElement('input');file.type='file';file.accept='image/jpeg,image/png,image/webp';file.setAttribute('aria-label','代表カード画像ファイル');
  const upload=document.createElement('button');upload.type='button';upload.textContent='選択した画像をアップロード';
  let objectUrl;
  function previewDraft(url){preview.hidden=art.hidden=!url;if(url){preview.src=art.src=url;}else{preview.removeAttribute('src');art.removeAttribute('src');}}
  input.addEventListener('input',()=>{file.value='';previewDraft(input.value.trim());});
  file.addEventListener('change',()=>{
    if(objectUrl)URL.revokeObjectURL(objectUrl);
    const selected=file.files[0];if(!selected)return;
    if(!['image/jpeg','image/png','image/webp'].includes(selected.type)||selected.size>5*1024*1024){file.value='';state.textContent='5MB以下のJPEG・PNG・WebPを選択してください。';return;}
    objectUrl=URL.createObjectURL(selected);previewDraft(objectUrl);state.textContent='プレビュー中（未保存）';
  });
  show(deck.image_url);previewDraft(deck.image_url);
  const save=document.createElement('button');save.type='submit';save.textContent='代表画像を保存';
  form.append(preview,caption,background,file,upload,label,save,state);
  upload.addEventListener('click',async()=>{
    const selected=file.files[0];if(!selected||save.disabled)return;
    save.disabled=upload.disabled=true;state.textContent='アップロード中...';
    try{
      const response=await fetch('/api/decks/'+deck.id+'/image/upload',{method:'POST',headers:{'Content-Type':selected.type},body:selected});
      const data=await response.json();if(!response.ok||!data.success)throw Error(data.error||'アップロードに失敗しました。');
      deck.image_url=input.value=data.deck.image_url;file.value='';show(deck.image_url);previewDraft(deck.image_url);
    }catch(error){state.textContent=error.message;}finally{save.disabled=upload.disabled=false;}
  });
  form.addEventListener('submit',async e=>{
    e.preventDefault();if(save.disabled)return;save.disabled=true;
    try {
      const response=await fetch('/api/decks/'+deck.id+'/image',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({imageUrl:input.value.trim()})});
      const data=await response.json();if(!response.ok||!data.success)throw Error(data.error||'画像を保存できませんでした。');
      deck.image_url=data.deck.image_url;show(deck.image_url);previewDraft(deck.image_url);
    }catch(error){state.textContent=error.message;}finally{save.disabled=false;}
  });
  return form;
}
