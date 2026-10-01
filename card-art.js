const CARD_ART_CROP=Object.freeze({x:.07,y:.14,w:.86,h:.46});
// Display-only crop. The original URL and bytes remain untouched.
function cardArtGeometry(width,height,naturalWidth,naturalHeight){
 const crop=CARD_ART_CROP;
 const scale=Math.max(width/(naturalWidth*crop.w),height/(naturalHeight*crop.h));
 return {width:naturalWidth*scale,height:naturalHeight*scale,
 left:(width-naturalWidth*crop.w*scale)/2-naturalWidth*crop.x*scale,
 top:(height-naturalHeight*crop.h*scale)/2-naturalHeight*crop.y*scale};
}
function attachCardArt(img,container){
 function layout(){
  if(!img.naturalWidth||!container.clientWidth)return;
  const g=cardArtGeometry(container.clientWidth,container.clientHeight,img.naturalWidth,img.naturalHeight);
  for(const key of ['width','height','left','top'])img.style[key]=g[key]+'px';
 }
 img.addEventListener('load',layout);
 if(typeof ResizeObserver!=='undefined'){
  const observer=new ResizeObserver(()=>{if(!container.isConnected){observer.disconnect();return;}layout();});observer.observe(container);
 }
 layout();
}
// Sector centroid supplies an angle-dependent focal radius (full circle => centre).
function sliceArtGeometry(start,end,naturalWidth,naturalHeight,cx=120,cy=120,radius=110){
 const angle=end-start,mid=(start+end)/2;
 const focalRadius=4*radius*Math.sin(angle/2)/(3*angle);
 const focalX=cx+Math.cos(mid)*focalRadius,focalY=cy+Math.sin(mid)*focalRadius;
 const angles=[start,end];
 for(let q=0;q<4;q++){let t=q*Math.PI/2;while(t<start)t+=2*Math.PI;if(t<=end)angles.push(t);}
 const xs=[cx,...angles.map(t=>cx+radius*Math.cos(t))],ys=[cy,...angles.map(t=>cy+radius*Math.sin(t))];
 const crop=CARD_ART_CROP,halfW=naturalWidth*crop.w/2,halfH=naturalHeight*crop.h/2;
 const scale=Math.max((focalX-Math.min(...xs))/halfW,(Math.max(...xs)-focalX)/halfW,
  (focalY-Math.min(...ys))/halfH,(Math.max(...ys)-focalY)/halfH);
 return {x:focalX-naturalWidth*(crop.x+crop.w/2)*scale,
 y:focalY-naturalHeight*(crop.y+crop.h/2)*scale,width:naturalWidth*scale,height:naturalHeight*scale,focalX,focalY};
}
if(typeof module!=='undefined')module.exports={cardArtGeometry,sliceArtGeometry,CARD_ART_CROP};
