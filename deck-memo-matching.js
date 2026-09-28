// Exact HN matching is used only by the saved-memo import preview.
function matchParticipants(participants, candidates) {
  const names=new Map(),nameCounts=new Map();
  for(const p of candidates) {
    const name=p.handle_name.trim();
    if(!names.has(name)) names.set(name,[]);
    names.get(name).push(p);
  }
  for(const p of participants) nameCounts.set(p.name.trim(),(nameCounts.get(p.name.trim())||0)+1);
  return participants.map(p=>{
    const matches=names.get(p.name.trim())||[];
    const candidate=matches.length===1?matches[0]:null;
    const ambiguous=matches.length>1 || (candidate && nameCounts.get(p.name.trim())>1);
    return {...p,dmpId:!ambiguous&&candidate?candidate.dmp_id:null,
      playerId:!ambiguous&&candidate?candidate.player_id:null,
      dmpHandleName:!ambiguous&&candidate?candidate.handle_name:null,
      matchStatus:ambiguous?'ambiguous':candidate?'matched':'unmatched'};
  });
}

module.exports={matchParticipants};
