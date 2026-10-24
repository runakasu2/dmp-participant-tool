// Independent, ten-record scroll-snap pages. Metadata is retained; rows render lazily.
(() => {
  class SavedListPager {
    constructor(root,label) {
      this.root=root;this.page=0;this.items=[];this.pages=[];
      root.classList.add('saved-list');
      this.track=document.createElement('div');this.track.className='saved-list-track';this.track.tabIndex=0;this.track.setAttribute('aria-label',label+'：10件単位で横にスクロール');
      this.controls=document.createElement('div');this.controls.className='saved-list-controls';this.controls.hidden=true;
      this.prev=document.createElement('button');this.prev.type='button';this.prev.textContent='前へ';
      this.next=document.createElement('button');this.next.type='button';this.next.textContent='次へ';
      this.counter=document.createElement('span');this.counter.setAttribute('role','status');
      this.controls.append(this.prev,this.counter,this.next);root.append(this.track,this.controls);
      this.prev.addEventListener('click',()=>this.move(this.page-1));this.next.addEventListener('click',()=>this.move(this.page+1));
      this.track.addEventListener('scroll',()=>{const width=this.track.clientWidth;if(width){const page=Math.round(this.track.scrollLeft/width);if(page!==this.page){this.page=Math.max(0,Math.min(page,this.pages.length-1));this.draw();}}},{passive:true});
      this.track.addEventListener('keydown',e=>{if(e.target!==this.track)return;if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();this.move(this.page+(e.key==='ArrowRight'?1:-1));}});
      this.resize=new ResizeObserver(()=>{this.track.scrollLeft=this.page*this.track.clientWidth;});this.resize.observe(this.track);
    }
    update(items,render,empty) {
      const timestamp=item=>{for(const field of ['updated_at','created_at','event_date']){const value=Date.parse(item[field]);if(Number.isFinite(value))return value;}return 0;};
      this.items=items.map(item=>({item,time:timestamp(item)})).sort((a,b)=>b.time-a.time||Number(b.item.id)-Number(a.item.id)).map(row=>row.item);this.render=render;
      this.page=Math.min(this.page,Math.max(0,Math.ceil(items.length/10)-1));this.track.replaceChildren();this.pages=[];this.rendered=[];
      for(let i=0;i<Math.ceil(items.length/10);i++){const section=document.createElement('div');section.className='saved-list-page';section.setAttribute('aria-label',`${i+1}ページ`);this.pages.push(section);this.track.append(section);}
      if(!items.length){const message=document.createElement('p');message.textContent=empty;this.track.append(message);}
      this.draw();this.track.scrollLeft=this.page*this.track.clientWidth;
    }
    draw() {
      // Render the destination and its neighbours before a swipe arrives.
      for(const i of this.rendered||[])if(Math.abs(i-this.page)>1){this.pages[i].replaceChildren();delete this.pages[i].dataset.rendered;}
      this.rendered=[];
      for(let i=Math.max(0,this.page-1);i<=Math.min(this.pages.length-1,this.page+1);i++){const section=this.pages[i];if(!section.dataset.rendered){section.append(...this.items.slice(i*10,i*10+10).map(this.render));section.dataset.rendered='true';}this.rendered.push(i);}
      this.prev.disabled=this.page<=0;this.next.disabled=this.page>=this.pages.length-1;this.counter.textContent=this.pages.length?`${this.page+1} / ${this.pages.length}ページ`:'0 / 0ページ';this.controls.hidden=!this.pages.length;
    }
    move(page){if(page<0||page>=this.pages.length)return;this.page=page;this.draw();this.track.scrollTo({left:page*this.track.clientWidth,behavior:'auto'});}
  }
  globalThis.SavedListPager=SavedListPager;
})();
