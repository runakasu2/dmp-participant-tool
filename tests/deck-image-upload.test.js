const {test}=require('node:test'),assert=require('node:assert/strict');
const {validateImage,LIMIT,installUploadRoute,uploadImage}=require('../deck-image-upload');
const {cardArtGeometry}=require('../card-art');
const samples=[['image/jpeg',Buffer.from([255,216,255,0])],['image/png',Buffer.from([137,80,78,71,13,10,26,10])],['image/webp',Buffer.from('RIFF0000WEBP')]];
test('image types validated against signatures, MIME and size',()=>{
 for(const [type,bytes] of samples){assert.equal(validateImage(bytes,type),type);assert.throws(()=>validateImage(bytes,'text/plain'));}
 assert.throws(()=>validateImage(Buffer.from('not image'),'image/jpeg'));assert.throws(()=>validateImage(Buffer.alloc(LIMIT+1),'image/png'));
});
test('uploads update URL only after storage success for all formats; failure keeps existing URL',async()=>{
 for(const fail of [false,true])for(const [type,bytes] of samples){
 let handler,updates=0;const pool={query:async sql=>{if(sql.startsWith('UPDATE'))updates++;return {rows:[{id:1,image_url:'https://example.com/new'}]};}};
 installUploadRoute({post(u,h){handler=h;}},pool,{raw:()=> (req,res,next)=>next()},async()=>{if(fail)throw Error('offline');return 'https://example.com/new';});
 const res={status(n){this.code=n;return this;},json(body){this.body=body;}};
 await handler({params:{id:1},headers:{'content-type':type},body:bytes},res);
 await new Promise(resolve=>setImmediate(resolve));assert.equal(updates,fail?0:1);assert.equal(res.body.success,!fail);
 }
});
test('Supabase uploads all original formats with private apikey and unique public paths',async()=>{
 const env={SUPABASE_URL:'https://test.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_test-value'};
 const paths=[];
 for(const [type,bytes] of samples){
 const result=await uploadImage(bytes,type,env,async(url,opts)=>{
 paths.push(url);assert.match(url,/\/storage\/v1\/object\/deck-images\/decks\/42\//);
 assert.equal(opts.body,bytes);assert.equal(new Headers(opts.headers).get('apikey'),env.SUPABASE_SECRET_KEY);
 assert.equal(new Headers(opts.headers).get('Content-Type'),type);assert.equal(opts.redirect,'error');assert.equal(new Headers(opts.headers).get('Authorization'),'Bearer '+env.SUPABASE_SECRET_KEY);
 return new Response(JSON.stringify({Key:"deck-images/test"}),{status:200});},42);
 assert.match(result,/\/object\/public\/deck-images\/decks\/42\//);assert.ok(!result.includes(env.SUPABASE_SECRET_KEY));
 }
 assert.equal(new Set(paths).size,3);
 await assert.rejects(uploadImage(samples[0][1],'image/jpeg',{},()=>{throw Error('must not fetch');},42));
 await assert.rejects(uploadImage(samples[0][1],'image/jpeg',env,async()=>new Response(JSON.stringify({message:"denied"}),{status:403}),42));
 const custom=await uploadImage(samples[0][1],'image/jpeg',{...env,SUPABASE_STORAGE_BUCKET:'custom'},async()=>new Response(JSON.stringify({Key:"custom/test"}),{status:200}),42);
 assert.match(custom,/public\/custom\//);
});
test('invalid files never reach Supabase and storage errors cannot expose secrets in API responses',async()=>{
 let handler,calls=0;const secret='private-secret-value';
 installUploadRoute({post(u,h){handler=h;}},{query:async()=>({rows:[{id:1}]})},{raw:()=> (req,res,next)=>next()},async()=>{calls++;throw Error(secret);});
 async function request(body,type){const res={status(n){this.code=n;return this;},json(b){this.body=b;}};handler({params:{id:1},body,headers:{'content-type':type}},res);await new Promise(r=>setImmediate(r));return res;}
 for(const [bytes,type] of [[Buffer.alloc(LIMIT+1),'image/png'],[Buffer.from('bad'),'image/png'],[samples[0][1],'text/plain']])assert.equal((await request(bytes,type)).code,400);
 assert.equal(calls,0);const result=await request(samples[0][1],'image/jpeg');assert.equal(result.code,502);assert.ok(!JSON.stringify(result.body).includes(secret));
});
test('crop fills viewport without exposing title or lower text region at mobile and desktop sizes',()=>{
 for(const w of [240,320,420,600]){
 const g=cardArtGeometry(w,230,600,840),scale=g.width/600;
 assert.ok(g.left+600*.07*scale<=.00001);assert.ok(g.top+840*.14*scale<=.00001);
 assert.ok(g.left+600*.93*scale>=w-.00001);assert.ok(g.top+840*.60*scale>=230-.00001);
 }
});

test('safe diagnostics distinguish configuration, HTTP failures and timeout without reflecting secrets',async()=>{
 const env={SUPABASE_URL:'https://test.supabase.co',SUPABASE_SECRET_KEY:'never-log-this',DATABASE_URL:'postgres://private'};
 let error;
 try{await uploadImage(samples[0][1],'image/jpeg',{},null,25);}catch(e){error=e;}
 assert.equal(error.uploadDiagnostic.stage,'configuration');assert.equal(error.uploadDiagnostic.secretKeyConfigured,false);
 try{await uploadImage(samples[0][1],'image/jpeg',env,async()=>new Response(JSON.stringify({statusCode:'404',message:'Bucket not found never-log-this postgres://private'}),{status:400}),25);}catch(e){error=e;}
 assert.equal(error.uploadDiagnostic.status,400);assert.equal(error.uploadDiagnostic.statusCode,404);
 assert.equal(error.uploadDiagnostic.message,'Bucket not found');assert.equal(error.uploadDiagnostic.bucket,'deck-images');
 assert.ok(!JSON.stringify(error.uploadDiagnostic).includes('never-log-this'));assert.ok(!JSON.stringify(error.uploadDiagnostic).includes('postgres://'));
 try{await uploadImage(samples[0][1],'image/jpeg',env,async()=>{throw Object.assign(Error('never-log-this'),{name:'TimeoutError'});},25);}catch(e){error=e;}
 assert.equal(error.uploadDiagnostic.stage,'storage-network');assert.equal(error.uploadDiagnostic.message,'Supabase request timed out');
});
