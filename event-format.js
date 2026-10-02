const cheerio=require('cheerio');
function normalizeFormat(text){
 const value=String(text||'').normalize('NFKC').trim();
 return {'オリジナル':'original','アドバンス':'advance','2ブロック':'2block'}[value]||null;
}
function extractEventFormat(html,eventName=''){
 const $=cheerio.load(html);const formats=new Set();
 $('td,th,dt,span,label').each((_,el)=>{
  const node=$(el),text=node.text().trim();
  if(/^フォーマット\s*[：:]?\s*$/.test(text)){
   const parent=node.parent();
   const rest=parent.text().trim().replace(/^フォーマット\s*[：:]?\s*/,'').trim();
   const value=normalizeFormat(rest)||normalizeFormat(node.next().text());if(value)formats.add(value);
  }else{
   const match=/^フォーマット\s*[：:]\s*(オリジナル|アドバンス|2ブロック|２ブロック)\s*$/.exec(text);
   if(match)formats.add(normalizeFormat(match[1]));
  }
 });
 if(formats.size)return formats.size===1?[...formats][0]:null;
 const fallback=[...String(eventName).normalize('NFKC').matchAll(/[【\[](オリジナル|アドバンス|2ブロック)[】\]]/g)].map(m=>normalizeFormat(m[1]));
 const unique=new Set(fallback);return unique.size===1?[...unique][0]:null;
}
module.exports={extractEventFormat,normalizeFormat};
