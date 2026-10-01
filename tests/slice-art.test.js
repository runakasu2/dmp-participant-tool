const {test}=require('node:test'),assert=require('node:assert/strict');
const {sliceArtGeometry,CARD_ART_CROP:c}=require('../card-art');
test('artwork focus aligns to each sector centroid, preserving aspect and crop coverage',()=>{
 for(const fraction of [.001,.03,.15,.5,.85,1])for(const start of [-Math.PI/2,0,Math.PI/2,Math.PI])for(const [w,h] of [[600,840],[1000,500]]){
 const end=start+2*Math.PI*fraction,g=sliceArtGeometry(start,end,w,h);
 assert.ok(Math.abs((g.x+g.width*(c.x+c.w/2))-g.focalX)<1e-8);
 assert.ok(Math.abs((g.y+g.height*(c.y+c.h/2))-g.focalY)<1e-8);
 assert.ok(Math.abs(g.width/g.height-w/h)<1e-8);
 for(let i=0;i<=100;i++){
 const t=start+(end-start)*i/100,x=120+110*Math.cos(t),y=120+110*Math.sin(t);
 assert.ok(x>=g.x+g.width*c.x-1e-8&&x<=g.x+g.width*(c.x+c.w)+1e-8);
 assert.ok(y>=g.y+g.height*c.y-1e-8&&y<=g.y+g.height*(c.y+c.h)+1e-8);
 }
 if(fraction===1)assert.ok(Math.hypot(g.focalX-120,g.focalY-120)<1e-8);
 }
});
