const LIMIT=5*1024*1024;
function validateImage(bytes,type){
 if(!Buffer.isBuffer(bytes)||!bytes.length)throw Error('画像ファイルを選択してください。');
 if(bytes.length>LIMIT)throw Error('画像は5MB以下にしてください。');
 const actual=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':
 bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'image/jpeg':
 bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'?'image/webp':null;
 if(!actual||actual!==type)throw Error('JPEG・PNG・WebPの画像を選択してください。');
 return actual;
}
// Never log raw exceptions, response bodies, URLs, headers or environment values.
function safeStatus(value){return /^\d{3}$/.test(String(value))?Number(value):null;}
function storageMessage(data){
 const text=String(data?.message||data?.error||'').toLowerCase();
 if(text.includes('bucket')&&text.includes('not found'))return 'Bucket not found';
 if(/row.level|policy|permission|unauthorized|access denied/.test(text))return 'Storage permission denied';
 if(/jwt|api.?key|token|signature/.test(text))return 'Storage authentication failed';
 if(/mime|content.type|file type/.test(text))return 'Storage rejected MIME type';
 if(/size|too large|payload/.test(text))return 'Storage rejected file size';
 return 'Storage request failed (response message omitted for credential safety)';
}
function diagnosticError(diagnostic){
 const error=new Error(diagnostic.message);error.uploadDiagnostic=diagnostic;return error;
}
async function uploadImage(bytes,type,env=process.env,fetcher=globalThis.fetch,deckId){
 validateImage(bytes,type);
 const {SUPABASE_URL:base,SUPABASE_SECRET_KEY:key}=env;
 const bucket=env.SUPABASE_STORAGE_BUCKET||'deck-images';
 const diagnostic={stage:'configuration',urlConfigured:!!base,secretKeyConfigured:!!key,secretKeyType:key?.startsWith("sb_secret_")?"secret":key?.startsWith("eyJ")?"legacy-jwt":"other",
 bucketConfigured:!!env.SUPABASE_STORAGE_BUCKET,bucket:bucket==='deck-images'?'deck-images':'custom (value omitted)',
 isDefaultBucket:bucket==='deck-images',mime:type,sizeBytes:bytes.length,deckId};
 let project;
 try {project=new URL(base);}catch{throw diagnosticError({...diagnostic,message:'SUPABASE_URL missing or invalid'});}
 if(!key||project.protocol!=='https:'||project.username||project.password||project.search||project.hash||project.pathname!=='/'||! /^[a-zA-Z0-9_-]+$/.test(bucket))throw diagnosticError({...diagnostic,message:'Supabase configuration invalid: check HTTPS project URL, secret key and bucket format'});
 if(!Number.isInteger(deckId)||deckId<1)throw Error('デッキIDが不正です。');
 const ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[type];
 const path='decks/'+deckId+'/'+Date.now()+'-'+require('node:crypto').randomUUID()+'.'+ext;
 let admin;
 let transportStatus=null;
 let transportFailure=null;
 try {
  admin=require('@supabase/supabase-js').createClient(base,key,{
   auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
   global:{fetch:async(url,options)=>{
    try {
     const response=await fetcher(url,{...options,redirect:'error',signal:AbortSignal.timeout(30000)});
     transportStatus=safeStatus(response.status);return response;
    }catch(error){transportFailure=error?.name==='TimeoutError'?'Supabase request timed out':'Supabase network request failed';throw Error(transportFailure);}
   }}
  });
 }catch{throw diagnosticError({...diagnostic,stage:'client-creation',message:'Supabase admin client creation failed'});}
 const storage=admin.storage.from(bucket);
 const {error}=await storage.upload(path,bytes,{contentType:type,upsert:false});
 if(error)throw diagnosticError({...diagnostic,stage:transportFailure?'storage-network':'storage-upload',path,
  status:transportStatus,statusCode:safeStatus(error.statusCode||error.status),message:transportFailure||storageMessage(error)});
 const {data}=storage.getPublicUrl(path);
 if(!data?.publicUrl||!data.publicUrl.startsWith(project.origin+'/storage/v1/object/public/')){
  throw diagnosticError({...diagnostic,stage:'public-url',path,message:'Public URL generation failed'});
 }
 return data.publicUrl;
}
function installUploadRoute(app,pool,express,upload=uploadImage){
 // Parse only this route into bounded memory; never write to the Render filesystem.
 app.post('/api/decks/:id/image/upload',(req,res)=>{
  express.raw({type:()=>true,limit:LIMIT})(req,res,async error=>{
   if(error)return res.status(error.status===413?413:400).json({success:false,error:'画像は5MB以下のJPEG・PNG・WebPを指定してください。'});
   const id=Number(req.params.id);if(!Number.isInteger(id)||id<1||id>2147483647)return res.status(400).json({success:false,error:'デッキIDが不正です。'});
   let type;try{type=validateImage(req.body,(req.headers['content-type']||'').split(';')[0]);}catch(e){return res.status(400).json({success:false,error:e.message});}
   let stage='deck-lookup';
   try{
    const exists=await pool.query('SELECT id FROM decks WHERE id=$1',[id]);if(!exists.rows.length)return res.status(404).json({success:false,error:'デッキが見つかりません。'});
    stage='storage-upload';
    const url=await upload(req.body,type,process.env,globalThis.fetch,id);
    stage='database-update';
    const result=await pool.query('UPDATE decks SET image_url=$2,updated_at=CURRENT_TIMESTAMP WHERE id=$1 RETURNING id,image_url',[id,url]);
    if(!result.rows.length)return res.status(409).json({success:false,error:'デッキが変更されました。一覧を更新してください。'});
    res.json({success:true,deck:result.rows[0]});
   }catch(e){
    console.error('[deck-image-upload] Upload failed',e.uploadDiagnostic||{
      stage,deckId:id,mime:type,sizeBytes:req.body.length,
      message:stage==='database-update'?'Image stored but database update failed':stage==='deck-lookup'?'Deck lookup failed':'Storage upload failed',
      databaseCode:/^[0-9A-Z]{5}$/.test(String(e.code))?e.code:null
    });
    res.status(502).json({success:false,error:'画像を保存できませんでした。Supabase Storageの設定・接続と画像を確認して再試行してください。既存画像は変更されていません。'});}
  });
 });
}
module.exports={LIMIT,validateImage,uploadImage,installUploadRoute};
