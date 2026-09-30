// Display-only crop. The original URL and bytes remain untouched.
function cardArtGeometry(width,height,naturalWidth,naturalHeight){
 const crop={x:.07,y:.14,w:.86,h:.46};
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
if(typeof module!=='undefined')module.exports={cardArtGeometry};
