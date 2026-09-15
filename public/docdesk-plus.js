(()=>{'use strict';
const $=id=>document.getElementById(id), ed=$('ed');
if(!ed)return;
let hits=[],hit=-1;
const changed=()=>{try{ed.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'formatOther'}))}catch{ed.dispatchEvent(new Event('input',{bubbles:true}))}};
const restoreSelection=()=>ed.focus();
const exec=(cmd,val=null)=>{restoreSelection();document.execCommand(cmd,false,val);changed()};
$('undoBtn')?.addEventListener('click',()=>exec('undo'));
$('redoBtn')?.addEventListener('click',()=>exec('redo'));
$('lineSpacing')?.addEventListener('change',e=>{
 const v=e.target.value;if(!v)return;const s=getSelection();if(!s?.rangeCount)return;
 const r=s.getRangeAt(0), blocks=[...ed.querySelectorAll('p,div,li,h1,h2,h3,blockquote')].filter(b=>{try{return r.intersectsNode(b)}catch{return false}});
 if(!blocks.length){const n=(r.startContainer.nodeType===1?r.startContainer:r.startContainer.parentElement)?.closest?.('p,div,li,h1,h2,h3,blockquote');if(n&&ed.contains(n))blocks.push(n)}
 blocks.forEach(b=>b.style.lineHeight=v);e.target.value='';changed();
});
function clearMark(){ed.querySelectorAll('[data-find-current="1"]').forEach(x=>x.removeAttribute('data-find-current'))}
function scan(){clearMark();hits=[];hit=-1;const q=$('findText')?.value||'',st=$('findStatus');if(!q){if(st)st.textContent='Enter text to search.';return}const low=q.toLowerCase(),w=document.createTreeWalker(ed,NodeFilter.SHOW_TEXT);while(w.nextNode()){const n=w.currentNode;if(n.parentElement?.closest('.gap'))continue;const text=n.nodeValue||'',tl=text.toLowerCase();let p=0;while((p=tl.indexOf(low,p))!==-1){hits.push({node:n,start:p,end:p+q.length});p+=Math.max(1,q.length)}}if(st)st.textContent=hits.length?`${hits.length} match${hits.length===1?'':'es'}`:'No matches.'}
function select(i){if(!hits.length){scan();if(!hits.length)return}clearMark();hit=(i+hits.length)%hits.length;let h=hits[hit];if(!h.node.isConnected){scan();if(!hits.length)return;h=hits[hit=0]}const r=document.createRange();r.setStart(h.node,h.start);r.setEnd(h.node,h.end);const s=getSelection();s.removeAllRanges();s.addRange(r);const p=h.node.parentElement;if(p){p.dataset.findCurrent='1';p.scrollIntoView({behavior:'smooth',block:'center'})}if($('findStatus'))$('findStatus').textContent=`Match ${hit+1} of ${hits.length}`}
function replaceOne(){if(hit<0)select(0);const h=hits[hit];if(!h?.node?.isConnected)return;const t=h.node.nodeValue||'',rep=$('replaceText')?.value||'';h.node.nodeValue=t.slice(0,h.start)+rep+t.slice(h.end);changed();scan();if(hits.length)select(0)}
function replaceAll(){scan();if(!hits.length)return;const rep=$('replaceText')?.value||'',n=hits.length;for(let i=hits.length-1;i>=0;i--){const h=hits[i],t=h.node.nodeValue||'';h.node.nodeValue=t.slice(0,h.start)+rep+t.slice(h.end)}changed();scan();if($('findStatus'))$('findStatus').textContent=`Replaced ${n} occurrence${n===1?'':'s'}.`}
$('findBtn')?.addEventListener('click',()=>{$('findPanel')?.classList.add('open');$('findText')?.focus();scan()});
$('closeFind')?.addEventListener('click',()=>{$('findPanel')?.classList.remove('open');clearMark()});
$('findText')?.addEventListener('input',scan);$('findNext')?.addEventListener('click',()=>select(hit+1));$('findPrev')?.addEventListener('click',()=>select(hit-1));$('replaceOne')?.addEventListener('click',replaceOne);$('replaceAll')?.addEventListener('click',replaceAll);
document.addEventListener('keydown',e=>{const ctrl=e.ctrlKey||e.metaKey;if(!ctrl)return;const k=e.key.toLowerCase();if(k==='f'){e.preventDefault();$('findPanel')?.classList.add('open');$('findText')?.focus();$('findText')?.select();scan()}else if(k==='h'){e.preventDefault();$('findPanel')?.classList.add('open');$('findText')?.focus();scan()}else if(k==='z'){e.preventDefault();exec(e.shiftKey?'redo':'undo')}else if(k==='y'){e.preventDefault();exec('redo')}});
})();
