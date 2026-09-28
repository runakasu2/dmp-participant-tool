const cheerio = require('cheerio');
const {createHash} = require('node:crypto');
const ORIGIN = 'https://tcg.sfc-jpn.jp';
const failure = (message, status = 502) => Object.assign(new Error(message), {status});
const MAX_PAGES = 50;

function parseTcgUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw failure('TCGマイスターのURLが不正です。', 400); }
  if (url.origin !== ORIGIN || url.username || url.password || url.pathname !== '/loginnum.asp') {
    throw failure('https://tcg.sfc-jpn.jp/loginnum.asp のURLを指定してください。', 400);
  }
  const tids = url.searchParams.getAll('tid'), mmps = url.searchParams.getAll('MMP');
  if (tids.length !== 1 || !/^[1-9]\d{0,19}$/.test(tids[0]) || mmps.length > 1 || (mmps[0] || '').length > 200) {
    throw failure('tidまたはMMPが不正です。', 400);
  }
  const tid = tids[0], mmp = mmps[0] || '';
  return {provider:'tcg_meister', tid, adminKey:tid, mmp,
    sourceUrl:ORIGIN + '/loginnum.asp?' + new URLSearchParams({tid, MMP:mmp})};
}

// Request-local cookie jar. Destinations and redirect paths stay on the public flow.
function publicSession(fetchImpl, tid = null) {
  const cookies = new Map();
  const signal = AbortSignal.timeout(60000);
  return async function request(path, options = {}) {
    let url = new URL(path, ORIGIN), method = options.method || 'GET', body = options.body;
    for (let redirects = 0; redirects <= 5; redirects++) {
      if (url.origin !== ORIGIN || url.username || url.password ||
          !['/loginnum.asp','/login_bin.asp','/tour.asp','/tourround.asp'].includes(url.pathname) ||
          (tid && url.searchParams.has('tid') && url.searchParams.get('tid') !== tid)) {
        throw failure('公開閲覧の転送先が不正です。');
      }
      const response = await fetchImpl(url.href, {method, body, redirect:'manual', cache:'no-store', signal,
        headers:{Accept:'text/html', 'Cache-Control':'no-cache',
          ...(method === 'POST' ? {'Content-Type':'application/x-www-form-urlencoded'} : {}),
          ...(cookies.size ? {Cookie:[...cookies].map(([k,v])=>k+'='+v).join('; ')} : {})}});
      const setCookies = response.headers.getSetCookie?.() || (response.headers.get('set-cookie') ? [response.headers.get('set-cookie')] : []);
      for (const cookie of setCookies) {
        const pair = cookie.split(';')[0], split = pair.indexOf('=');
        if (split > 0) cookies.set(pair.slice(0,split),pair.slice(split+1));
      }
      if ([301,302,303,307,308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) throw failure('公開閲覧の転送先を取得できませんでした。');
        url = new URL(location,url);
        if ([301,302,303].includes(response.status)) {method='GET';body=undefined;}
        await response.body?.cancel();
        continue;
      }
      if (!response.ok) throw failure('TCGマイスターの取得に失敗しました（HTTP ' + response.status + '）。');
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > 4 * 1024 * 1024) throw failure('対戦表のサイズが上限を超えました。');
      const charset = /charset\s*=\s*["']?([^\s;"']+)/i.exec(response.headers.get('content-type') || '')?.[1];
      let html;
      try { html = new TextDecoder(charset || 'utf-8', {fatal:true}).decode(buffer); }
      catch { html = new TextDecoder('shift_jis').decode(buffer); }
      return {html, url:url.href};
    }
    throw failure('公開閲覧の転送回数が上限を超えました。');
  };
}

function links(html, tid) {
  const $ = cheerio.load(html), hrefs = $('a[href]').map((_,a)=>$(a).attr('href')).get();
  // The public site emits pagination as PageStr string literals. Parse only literals; never eval JS.
  $('script').each((_,script)=>{
    const source = $(script).html() || '';
    for (const match of source.matchAll(/PageStr\s*=\s*PageStr\s*\+\s*("(?:[^"\\]|\\.)*")\s*;/g)) {
      let fragment;
      try {fragment=JSON.parse(match[1]);} catch {continue;}
      const dom=cheerio.load(fragment);
      dom('a[href]').each((_,a)=>hrefs.push(dom(a).attr('href')));
    }
  });
  return hrefs.flatMap(href=>{
    let url; try {url=new URL(href,ORIGIN);} catch {return [];}
    if(url.origin!==ORIGIN || url.pathname!=='/tourround.asp' || url.searchParams.get('tid')!==tid) return [];
    return [url];
  });
}
function latestRound(html, tid) {
  const rounds = links(html,tid).map(url=>url.searchParams.get('kno'))
    .filter(n=>/^[1-9]\d*$/.test(n) && Number(n)<9999999).map(Number);
  return rounds.length ? Math.max(...rounds) : null;
}
function parseRound(html, tid, round) {
  const $ = cheerio.load(html), participants=[];
  let recognized=false;
  $('table').each((_,table)=>{
    let columns=null;
    $(table).find('tr').each((_,tr)=>{
      // Do not read descendant tables' cells as part of their container row.
      if ($(tr).closest('table')[0] !== table) return;
      const cells=$(tr).children('td,th');
      const texts=cells.map((_,c)=>$(c).text().trim()).get();
      const name=texts.indexOf('あなたのお名前');
      if(name>=0 && texts.includes('No.')) {
        columns={name,raw:texts.indexOf('No.'),table:texts.indexOf('卓番'),opponent:texts.indexOf('対戦相手のお名前')};
        recognized=true;return;
      }
      if(!columns || texts.length<5) return;
      const handleName=texts[columns.name];
      if(!handleName || handleName==='不戦勝') return;
      const nameCell=cells.eq(columns.name);
      const handler=nameCell.attr('onclick') || nameCell.find('[onclick]').first().attr('onclick') || '';
      const internalParticipantId=/VisitorLock\(\s*['"](\d+)['"]\s*,/i.exec(handler)?.[1] || null;
      const rawNo=texts[columns.raw] || '';
      const tableText=texts[columns.table] || '';
      const tableNumber=/^[1-9]\d*$/.test(tableText) ? Number(tableText) : null;
      const bye=tableText.includes('不戦勝') || (texts[columns.opponent] || '').includes('不戦勝');
      // Fallback is scoped to this memo/tid and cannot be confused with a DMP ID.
      const participantKey=internalParticipantId ? 'id:'+internalParticipantId :
        'raw:'+createHash('sha256').update(JSON.stringify([rawNo,handleName])).digest('hex');
      participants.push({provider:'tcg_meister',tid,round,table:tableNumber,tableNumber,
        rawNo,entryNo:rawNo,handleName,name:handleName,internalParticipantId,participantKey,bye,dmpId:null});
    });
  });
  if(!recognized) throw failure('TCGマイスターの対戦表を読み取れませんでした。公開状態を確認してください。');
  const pages=links(html,tid).filter(url=>url.searchParams.get('kno')===String(round))
    .map(url=>url.searchParams.get('Page')).filter(p=>p!==null);
  if(pages.some(p=>!/^\d+$/.test(p)||Number(p)<1||Number(p)>MAX_PAGES)) throw failure('対戦表のページ数が上限を超えています。');
  return {participants,pages:pages.map(Number)};
}
async function fetchTcgMatching(source, fetchImpl = fetch) {
  try {
    const request=publicSession(fetchImpl,source.tid);
    const login=await request(source.sourceUrl);
    const $=cheerio.load(login.html);
    const form=$('form').filter((_,f)=>{
      try {const url=new URL($(f).attr('action'),ORIGIN);return url.origin===ORIGIN&&url.pathname==='/login_bin.asp';} catch {return false;}
    }).first();
    if(!form.length || form.find('input[name="tid"]').val()!==source.tid) throw failure('公開閲覧フォームが見つかりません。tidを確認してください。');
    const payload=new URLSearchParams();
    for(const key of ['tid','MMP','OnlineResult','Dummy','ShikibetsuNo','flu']) payload.set(key,form.find('input[name="'+key+'"]').val() || '');
    // Always anonymous, regardless of the contents of the fetched form.
    for(const [key,value] of Object.entries({tid:source.tid,MMP:source.mmp,OnlineResult:'2',Dummy:'null',ShikibetsuNo:'',flu:'',SelectShikibetsuNo:'',InputShikibetsuNo:'',pwd:''})) payload.set(key,value);
    await request('/login_bin.asp',{method:'POST',body:payload.toString()});
    const tour=await request('/tour.asp?'+new URLSearchParams({tid:source.tid}));
    const tourDom=cheerio.load(tour.html);
    if(tourDom('form[action="tour.asp"] input[name="tid"]').val()!==source.tid) throw failure('公開閲覧に進めませんでした。tid・公開状態を確認してください。');
    const round=latestRound(tour.html,source.tid);
    if(round===null) return {latestRound:null,participants:[]};
    const pending=new Set([1]),done=new Set(),players=new Map();
    while(pending.size) {
      const page=Math.min(...pending);pending.delete(page);done.add(page);
      if(done.size>MAX_PAGES) throw failure('対戦表のページ数が上限を超えています。');
      const result=await request('/tourround.asp?'+new URLSearchParams({tid:source.tid,kno:String(round),Page:String(page),Sort:'Table',Order:''}));
      const parsed=parseRound(result.html,source.tid,round);
      const lastPage=Math.max(page,...parsed.pages);
      for(let next=1;next<=lastPage;next++) if(!done.has(next)) pending.add(next);
      for(const p of parsed.participants) {
        const old=players.get(p.participantKey);
        if(old && (old.name!==p.name || old.table!==p.table)) throw failure('対戦表が取得中に変わりました。再取得してください。');
        players.set(p.participantKey,p);
      }
    }
    return {latestRound:round,participants:[...players.values()].sort((a,b)=>(a.table??Infinity)-(b.table??Infinity))};
  } catch(err) {
    if(err.status) throw err;
    if(['TimeoutError','AbortError'].includes(err.name)) throw failure('TCGマイスターの取得がタイムアウトしました。',504);
    throw failure('TCGマイスターに接続できませんでした。再取得してください。');
  }
}
module.exports={parseTcgUrl,publicSession,latestRound,parseRound,fetchTcgMatching};
