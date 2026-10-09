// Qualifying-only observations and inference. No DB, API or UI dependencies.
const cheerio=require('cheerio');
const {parseTcgUrl,publicSession,links,parseTableNumber}=require('./tcg-meister');
const fail=(message,status=502)=>Object.assign(new Error(message),{status});
const tidy=s=>s.replace(/\s|\u00a0/g,'').replace(/％/g,'%');
const numeric=s=>s!=null&&/^\d+(?:\.\d+)?%?$/.test(s.trim())?Number(s.trim().replace('%','')):null;
const points=s=>s!=null&&/^\d+$/.test(s.trim())&&Number.isSafeInteger(Number(s.trim()))?Number(s.trim()):null;
const internal=cell=>/VisitorLock\(\s*['"](\d+)['"]\s*,/i.exec(cell.attr('onclick')||cell.find('[onclick]').first().attr('onclick')||'')?.[1]||null;
const isBye=s=>/^(?:bye(?:\s*[（(]不戦勝[）)])?|不戦勝)$/i.test(s.trim());
function parsePage(html,tid,round=null) {
  const $=cheerio.load(html),rows=[];let recognized=false;
  $('table').each((_,table)=>{
    let columns;
    $(table).find('tr').each((_,tr)=>{
      if($(tr).closest('table')[0]!==table)return;
      const cells=$(tr).children('td,th'),text=cells.map((_,c)=>$(c).text().trim()).get(),heads=text.map(tidy);
      const name=heads.indexOf('あなたのお名前');
      if(name>=0 && heads.includes(round===null?'順位':'卓番') && (round===null||heads.includes('対戦相手のお名前'))) {
        const opponent=heads.indexOf('対戦相手のお名前');
        columns={name,table:heads.indexOf('卓番'),rank:heads.indexOf('順位'),raw:heads.indexOf('No.'),opponent,
          score:heads.findIndex((h,i)=>h==='累計得点'&&(opponent<0||i<opponent)),
          opponentScore:heads.findIndex((h,i)=>h==='累計得点'&&i>opponent&&opponent>=0),
          omw:heads.indexOf('OMW%'),averageOmw:heads.indexOf('平均OMW%')};recognized=true;return;
      }
      if(!columns||text.length<=columns.name||!text[columns.name]||isBye(text[columns.name]))return;
      const id=internal(cells.eq(columns.name)),tableText=text[columns.table]||'';
      const row={tid,playerKey:id?tid+':'+id:null,internalParticipantId:id,name:text[columns.name],rawNo:text[columns.raw]||null};
      if(round===null)Object.assign(row,{rank:points(text[columns.rank]),finalScore:points(text[columns.score]),omw:numeric(text[columns.omw]),averageOmw:numeric(text[columns.averageOmw])});
      else Object.assign(row,{round,table:parseTableNumber(tableText),tableRaw:tableText,startScore:points(text[columns.score]),
        withdrawn:/棄権|ドロップ|失格/.test(tableText+' '+(text[columns.opponent]||'')),scoreCorrected:/得点訂正|点数訂正/.test(tableText+' '+(text[columns.opponent]||'')),
        opponentName:text[columns.opponent]||null,opponentInternalId:internal(cells.eq(columns.opponent)),
        opponentStartScore:points(text[columns.opponentScore]),startScoreSource:columns.score<0?'missing_column':points(text[columns.score])==null?'missing_value':'html',bye:/不戦勝|\bbye\b/i.test(tableText)||isBye(text[columns.opponent]||'')});
      rows.push(row);
    });
  });
  if(!recognized)throw fail(round===null?'予選成績表の形式を認識できません。':'予選対戦表の形式を認識できません。');
  return rows;
}
const parseQualifyingRound=(html,tid,round)=>parsePage(html,tid,round);
const parseQualifyingStandings=(html,tid)=>parsePage(html,tid);
function restoreQualifyingResults({tid,rounds,standings,finalRound,initialScore=null,zeroGainOutcome=null}) {
  if(zeroGainOutcome!==null&&zeroGainOutcome!=='double_loss')throw fail('0/0の判定設定が不正です。',400);
  if(initialScore!==null && initialScore!==0)throw fail('初期得点補完には initialScore: 0 を明示してください。',400);
  if(!/^[1-9]\d{0,19}$/.test(tid)||!Number.isInteger(finalRound)||finalRound<1||finalRound>32)throw fail('大会ID・予選最終回戦が不正です。',400);
  const byRound=new Map(),diagnostics=[];
  const index=rows=>{const m=new Map();for(const p of rows)if(p.internalParticipantId){const list=m.get(p.internalParticipantId)||[];list.push(p);m.set(p.internalParticipantId,list);}return m;};
  for(const r of rounds){if(r.round<1||r.round>finalRound||byRound.has(r.round))throw fail('ラウンドの指定が重複・範囲外です。',400);if(r.rows.some(p=>p.tid!==tid||p.round!==r.round))throw fail('大会・ラウンドが一致しません。',400);byRound.set(r.round,index(r.rows));}
  if(standings.some(p=>p.tid!==tid))throw fail('成績表の大会IDが一致しません。',400);
  const final=index(standings),matches=[];
  for(let round=1;round<=finalRound;round++) {
    const source=rounds.find(r=>r.round===round);
    if(!source){diagnostics.push({round,reason:'missing_round'});continue;}
    const groups=new Map();
    for(const row of source.rows){const key=row.bye?'bye:'+row.playerKey:row.table!=null?'table:'+row.table:'missing:'+row.playerKey;const group=groups.get(key)||[];group.push(row);groups.set(key,group);}
    for(const [tableKey,observations] of [...groups].sort(([a],[b])=>a.localeCompare(b))) {
      const unique=new Map();for(const p of observations)unique.set(p.playerKey||JSON.stringify(p),p);
      const sides=[...unique.values()].sort((a,b)=>String(a.internalParticipantId).localeCompare(String(b.internalParticipantId)));
      const match={tid,round,table:sides[0]?.table??null,matchKey:tid+':'+round+':'+sides.map(p=>p.internalParticipantId||'?').join(':'),sides,status:'unresolved',reasons:[],deltas:null,winnerKey:null,loserKey:null};
      const reason=r=>{if(!match.reasons.includes(r))match.reasons.push(r);};
      if(sides.some(p=>p.playerKey!==(p.internalParticipantId?tid+':'+p.internalParticipantId:null)))reason('internal_id_mismatch');
      if(sides.some(p=>!p.internalParticipantId))reason('missing_internal_id');
      if(sides.some(p=>(byRound.get(round)?.get(p.internalParticipantId)?.length||0)>1))reason('duplicate_row');
      if(sides.some(p=>p.withdrawn))reason('withdrawn');
      if(sides.some(p=>p.scoreCorrected))reason('score_correction');
      if(sides.some(p=>p.bye)){
        match.status='bye';reason('bye');
        const ends=(round===finalRound?final:byRound.get(round+1))?.get(sides[0]?.internalParticipantId);
        const end=ends?.length===1?(round===finalRound?ends[0].finalScore:ends[0].startScore):null;
        match.byeScoreDelta=sides.length===1&&sides[0].startScore!=null&&end!=null?end-sides[0].startScore:null;
        // The site's 不戦勝 label alone does not distinguish an awarded Bye from a dropped player.
        match.byeType=match.byeScoreDelta===0?'no_score_gain':match.byeScoreDelta===3?'three_point_gain':match.byeScoreDelta==null?'unknown':'other_score_change';
      }
      else {
        if(sides.length!==2)reason('opponent_unknown');
        if(sides.length===2){const [a,b]=sides;
          if(a.table==null||b.table==null)reason('missing_table');
          if(a.opponentName?.trim()!==b.name.trim()||b.opponentName?.trim()!==a.name.trim())reason('opponent_mismatch');
          if((a.opponentInternalId&&a.opponentInternalId!==b.internalParticipantId)||(b.opponentInternalId&&b.opponentInternalId!==a.internalParticipantId))reason('internal_id_mismatch');
          if(a.opponentStartScore!=null&&b.startScore!=null&&a.opponentStartScore!==b.startScore||b.opponentStartScore!=null&&a.startScore!=null&&b.opponentStartScore!==a.startScore)reason('opponent_score_mismatch');
          const target=round===finalRound?final:byRound.get(round+1);
          const ends=sides.map(p=>target?.get(p.internalParticipantId));
          if(ends.some(p=>!p))reason(round===finalRound?'missing_standings':'missing_next_round');
          if(ends.some(p=>p?.length>1))reason('duplicate_end_score');
          if(ends.some(rows=>rows?.some(p=>p.scoreCorrected)))reason('score_correction');
          const endScores=ends.map(p=>p?.length===1?(round===finalRound?p[0].finalScore:p[0].startScore):null);
          const canUseInitial=round===1&&finalRound>1&&initialScore===0;
          const startScores=sides.map(p=>p.startScore??(canUseInitial&&p.startScoreSource==='missing_column'?0:null));
          if((a.opponentStartScore!=null&&startScores[1]!=null&&a.opponentStartScore!==startScores[1])||(b.opponentStartScore!=null&&startScores[0]!=null&&b.opponentStartScore!==startScores[0]))reason('opponent_score_mismatch');
          match.startScoreSources=sides.map(p=>p.startScore==null&&canUseInitial&&p.startScoreSource==='missing_column'?'explicit_initial_zero':p.startScoreSource||'html');
          if(canUseInitial&&sides.some(p=>p.startScore!=null&&p.startScore!==0))reason('initial_score_mismatch');
          if(startScores.some(p=>p==null)||endScores.some(p=>p==null))reason('missing_score');
          if(endScores.every(p=>p!=null)&&startScores.every(p=>p!=null)){
            match.deltas=sides.map((p,i)=>endScores[i]-startScores[i]);
            const [x,y]=match.deltas;
            if(x===0&&y===0){
              if(zeroGainOutcome==='double_loss'&&!match.reasons.length){match.status='confirmed';match.outcome='double_loss';match.loserKeys=sides.map(p=>p.playerKey);}
              else {reason('zero_gain_ambiguous');match.possibleOutcomes=['double_loss','unreported','draw_or_score_correction'];}
            }
            else if(!((x===3&&y===0)||(x===0&&y===3)))reason('score_inconsistent');
            if(!match.reasons.length&&match.outcome!=='double_loss'){match.outcome='win_loss';const win=x===3?0:1;match.status='confirmed';match.winnerKey=sides[win].playerKey;match.loserKey=sides[1-win].playerKey;}
          }
        }
      }
      matches.push(match);
    }
  }
  const roundSummaries=Array.from({length:finalRound},(_,i)=>{
    const round=i+1,rows=rounds.find(r=>r.round===round)?.rows||[],entries=matches.filter(m=>m.round===round);
    const ids=rows.map(p=>p.internalParticipantId).filter(Boolean),reasonCounts={};
    for(const m of entries.filter(m=>m.status==='unresolved'))for(const reason of m.reasons)reasonCounts[reason]=(reasonCounts[reason]||0)+1;
    const normal=entries.filter(m=>m.status!=='bye');
    const structural=new Set(['missing_internal_id','duplicate_row','missing_table','opponent_unknown','opponent_mismatch','internal_id_mismatch']);
    return {round,rowCount:rows.length,participantCount:new Set(ids).size,unidentifiedRows:rows.length-ids.length,
      duplicateRows:ids.length-new Set(ids).size,normalMatchCount:normal.length,
      invalidPairCount:normal.filter(m=>m.reasons.some(r=>structural.has(r))).length,
      byeCount:entries.filter(m=>m.status==='bye').length,confirmedCount:normal.filter(m=>m.status==='confirmed').length,
      doubleLossCount:normal.filter(m=>m.outcome==='double_loss').length,
      unresolvedCount:normal.filter(m=>m.status==='unresolved').length,unresolvedReasons:reasonCounts};
  });
  return {provider:'tcg_meister',phase:'qualifying',tid,finalRound,initialScore,zeroGainOutcome,rounds,standings,matches,diagnostics,roundSummaries};
}
async function fetchTcgQualifyingResults(value,{fetchImpl=fetch,finalRound,initialScore=null,zeroGainOutcome=null,maxPages=50,maxTotalPages=250}={}) {
  if(zeroGainOutcome!==null&&zeroGainOutcome!=='double_loss')throw fail('0/0の判定設定が不正です。',400);
  if(initialScore!==null&&initialScore!==0)throw fail('初期得点補完には initialScore: 0 を明示してください。',400);
  const source=typeof value==='string'?parseTcgUrl(value):parseTcgUrl(value.sourceUrl);
  if(!Number.isInteger(finalRound)||finalRound<1||finalRound>32||!Number.isInteger(maxPages)||maxPages<1||maxPages>50||!Number.isInteger(maxTotalPages)||maxTotalPages<1||maxTotalPages>250)throw fail('予選回戦数・取得上限が不正です。',400);
  try {
    // Retain the existing 60-second session deadline, 4MiB/page and redirect allowlist.
    const request=publicSession(fetchImpl,source.tid);
    const login=await request(source.sourceUrl),$=cheerio.load(login.html);
    const form=$('form').filter((_,f)=>{try{return new URL($(f).attr('action'),'https://tcg.sfc-jpn.jp').href==='https://tcg.sfc-jpn.jp/login_bin.asp';}catch{return false;}}).first();
    if(!form.length||form.find('input[name="tid"]').val()!==source.tid)throw fail('公開閲覧フォームが見つかりません。');
    const payload=new URLSearchParams();for(const key of ['tid','MMP','OnlineResult','Dummy','ShikibetsuNo','flu'])payload.set(key,form.find('input[name="'+key+'"]').val()||'');
    for(const [k,v]of Object.entries({tid:source.tid,MMP:source.mmp,OnlineResult:'2',Dummy:'null',ShikibetsuNo:'',flu:'',SelectShikibetsuNo:'',InputShikibetsuNo:'',pwd:''}))payload.set(k,v);
    await request('/login_bin.asp',{method:'POST',body:payload.toString()});
    const tour=await request('/tour.asp?'+new URLSearchParams({tid:source.tid}));
    if(cheerio.load(tour.html)('form[action="tour.asp"] input[name="tid"]').val()!==source.tid)throw fail('公開回戦一覧を取得できません。');
    const discovered=links(tour.html,source.tid);let total=0;
    async function pages(kno,parser) {
      const link=discovered.find(u=>u.searchParams.get('kno')===String(kno)&&(u.searchParams.get('znt')===null||u.searchParams.get('znt')===(kno===9999999?'1':'0')));
      if(!link)throw fail('予選ラウンド／成績表のリンクがありません：'+kno);
      const pending=new Set([1]),done=new Set(),rows=[];
      while(pending.size){const page=Math.min(...pending);pending.delete(page);done.add(page);
        if(++total>maxTotalPages||done.size>maxPages)throw fail('取得ページ数が上限を超えました。');
        const url=new URL(link);url.searchParams.set('Page',String(page));url.searchParams.set('Sort','Table');url.searchParams.set('Order','');
        const result=await request(url.href);
        const destination=new URL(result.url);
        if(destination.pathname!=='/tourround.asp'||destination.searchParams.get('tid')!==source.tid||destination.searchParams.get('kno')!==String(kno))throw fail('取得ページの大会・回戦が一致しません。');
        const dom=cheerio.load(result.html),form=dom('form[action="tour.asp"]');
        if(form.length){for(const [key,expected]of [['tid',source.tid],['kno',String(kno)]]){const actual=form.find('input[name="'+key+'"]').val();if(actual!=null&&actual!==expected)throw fail('取得ページの大会・回戦が一致しません。');}}
        rows.push(...parser(result.html));
        const linked=links(result.html,source.tid).filter(u=>u.searchParams.get('kno')===String(kno)).map(u=>u.searchParams.get('Page')).filter(p=>p!==null);
        if(linked.some(p=>!/^\d+$/.test(p)||Number(p)<1||Number(p)>maxPages))throw fail('取得ページ数が上限を超えました。');
        const last=Math.max(page,...linked.map(Number));for(let n=1;n<=last;n++)if(!done.has(n))pending.add(n);
      }
      if(!rows.length)throw fail('公開ページに解析対象の行がありません。');
      return rows;
    }
    const rounds=[];for(let round=1;round<=finalRound;round++)rounds.push({round,rows:await pages(round,html=>parseQualifyingRound(html,source.tid,round))});
    const standings=await pages(9999999,html=>parseQualifyingStandings(html,source.tid));
    return restoreQualifyingResults({tid:source.tid,rounds,standings,finalRound,initialScore,zeroGainOutcome});
  }catch(e){if(e.status)throw e;throw fail(['TimeoutError','AbortError'].includes(e.name)?'全ラウンド取得がタイムアウトしました。':'全ラウンド取得に失敗しました。', ['TimeoutError','AbortError'].includes(e.name)?504:502);}
}
module.exports={parseQualifyingRound,parseQualifyingStandings,restoreQualifyingResults,fetchTcgQualifyingResults};
