const {test}=require('node:test'),assert=require('node:assert/strict');
const {extractEventFormat}=require('../event-format');
test('explicit inline DMP format overrides conflicting title',()=>{
 for(const [name,format] of [['オリジナル','original'],['アドバンス','advance'],['2ブロック','2block']]){
 assert.equal(extractEventFormat(`<td><nobr><span>フォーマット：</span>${name}<img src="spacer.gif"></nobr></td>`,'【オリジナル】'),format);
 }
});
test('table and definition labels, fallback, unknown and ambiguity',()=>{
 assert.equal(extractEventFormat('<table><tr><th>フォーマット</th><td>２ブロック</td></tr></table>'),'2block');
 assert.equal(extractEventFormat('<dl><dt>フォーマット</dt><dd>アドバンス</dd></dl>'),'advance');
 assert.equal(extractEventFormat('<h1>大会</h1>','大会【2ブロック】'),'2block');
 assert.equal(extractEventFormat('<h1>大会</h1>','オリジナルっぽい大会'),null);
 assert.equal(extractEventFormat('','【アドバンス】【オリジナル】'),null);
});
