(()=>{'use strict';
const API='/api/sftp';
let auth={};
const chosen=new Map();
const nativeFetch=window.fetch.bind(window);
window.fetch=async(...args)=>{
  try{
    const [url,opt]=args;
    if(String(url).includes('/api/sftp')&&opt?.body){
      const body=JSON.parse(opt.body);
      if(body.action&&!['status','unlock'].includes(body.action)){
        auth={authMode:body.authMode,username:body.username,appToken:body.appToken};
        if(body.authMode==='manual')auth.password=body.password;
      }
    }
  }catch{}
  return nativeFetch(...args);
};
const $=id=>document.getElementById(id);
const base=p=>{const x=String(p||'').replace(/\/+$/,'');return x.split('/').pop()||'download'};
const join=(p,n)=>p==='/'?`/${n}`:p==='.'?`./${n}`:`${String(p).replace(/\/+$/,'')}/${n}`;
const human=n=>{const u=['B','KB','MB','GB'];let i=0,v=n||0;while(v>=1024&&i<3){v/=1024;i++}return`${i&&v<10?v.toFixed(1):Math.round(v)} ${u[i]}`};
function note(msg,bad=false){if(window.console)console[bad?'error':'log']('[BGA SFTP Download]',msg);const t=$('toast');if(t){t.textContent=msg;t.classList.toggle('bad',bad);t.classList.remove('hidden');setTimeout(()=>t.classList.add('hidden'),4500)}}
async function post(action,extra={},blob=false){
  if(!auth.authMode)throw new Error('Connect to SFTP first.');
  const r=await nativeFetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...auth,...extra})});
  if(!r.ok){let d={};try{d=await r.json()}catch{}throw new Error(d.error||`HTTP ${r.status}`)}
  return blob?r.blob():r.json();
}
async function save(blob,name){
  if(window.showSaveFilePicker){try{const h=await showSaveFilePicker({suggestedName:name});const w=await h.createWritable();await w.write(blob);await w.close();note(`Saved ${name}.`);return}catch(e){if(e.name==='AbortError')return}}
  if(navigator.share&&navigator.canShare){try{const f=new File([blob],name,{type:blob.type||'application/octet-stream'});if(navigator.canShare({files:[f]})){await navigator.share({files:[f],title:name});return}}catch(e){if(e.name==='AbortError')return}}
  const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1500);
}
function crc32(bytes){let c=0xffffffff;for(const b of bytes){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0)}return(c^0xffffffff)>>>0}
const u16=n=>new Uint8Array([n&255,(n>>>8)&255]);const u32=n=>new Uint8Array([n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255]);
function cat(a){let n=a.reduce((x,y)=>x+y.length,0),o=new Uint8Array(n),p=0;for(const x of a){o.set(x,p);p+=x.length}return o}
function zip(files){const enc=new TextEncoder(),locals=[],centrals=[];let off=0;for(const f of files){const name=enc.encode(f.name.replace(/^\/+/,'')),data=f.bytes,crc=crc32(data);const local=cat([u32(0x04034b50),u16(20),u16(0),u16(0),u16(0),u16(0),u32(crc),u32(data.length),u32(data.length),u16(name.length),u16(0),name,data]);locals.push(local);centrals.push(cat([u32(0x02014b50),u16(20),u16(20),u16(0),u16(0),u16(0),u16(0),u32(crc),u32(data.length),u32(data.length),u16(name.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(off),name]));off+=local.length}const cen=cat(centrals),end=cat([u32(0x06054b50),u16(0),u16(0),u16(files.length),u16(files.length),u32(cen.length),u32(off),u16(0)]);return new Blob([...locals,cen,end],{type:'application/zip'})}
async function collect(path,prefix,out,state){
  const d=await post('list',{path});for(const x of d.entries||[]){const rel=prefix?`${prefix}/${x.name}`:x.name;if(x.type==='d'){await collect(x.path,rel,out,state);continue}if(Number(x.size)>4*1024*1024)throw new Error(`${x.path} exceeds the hosted 4 MB per-file limit.`);const b=await post('download',{path:x.path},true),bytes=new Uint8Array(await b.arrayBuffer());state.count++;state.bytes+=bytes.length;if(state.count>300)throw new Error('More than 300 files. Download a smaller section.');if(state.bytes>100*1024*1024)throw new Error('ZIP exceeds the 100 MB browser safety limit.');out.push({name:rel,bytes});note(`Packed ${rel} (${human(bytes.length)})`)}
async function downloadItems(items,name){try{if(items.length===1&&items[0].type!=='d'){return save(await post('download',{path:items[0].path},true),items[0].name)}note('Building ZIP…');const out=[],state={count:0,bytes:0};for(const x of items){if(x.type==='d')await collect(x.path,x.name,out,state);else{const b=await post('download',{path:x.path},true),bytes=new Uint8Array(await b.arrayBuffer());state.count++;state.bytes+=bytes.length;out.push({name:x.name,bytes})}}if(!out.length)throw new Error('Nothing to download.');await save(zip(out),name.endsWith('.zip')?name:`${name}.zip`);note(`Prepared ${out.length} file(s).`)}catch(e){note(e.message,true)}}
function currentPath(){return $('path')?.value?.trim()||'.'}
function selectedPreview(){const p=$('previewPath')?.textContent?.trim(),n=$('previewTitle')?.textContent?.trim();if(!p||!n||n==='Preview')return null;const folder=$('meta')?.textContent?.startsWith('Folder');return{path:p,name:n,type:folder?'d':'-'}}
function refreshRows(){
  const rows=[...document.querySelectorAll('#rows tr')];for(const tr of rows){if(tr.dataset.dlReady)return;tr.dataset.dlReady='1';const name=tr.querySelector('.file-name span:last-child')?.textContent;if(!name)continue;const type=tr.lastElementChild?.textContent==='Folder'?'d':'-';const path=join(currentPath(),name);const td=document.createElement('td');td.style.cssText='width:28px;text-align:center;padding:6px';const cb=document.createElement('input');cb.type='checkbox';cb.title='Select for download';cb.style.cssText='width:16px;height:16px;accent-color:#2788f5';cb.addEventListener('click',e=>{e.stopPropagation();if(cb.checked)chosen.set(path,{path,name,type});else chosen.delete(path);updateCount()});td.appendChild(cb);tr.insertBefore(td,tr.firstChild)}
}
function updateCount(){const b=$('dlSelected');if(b)b.textContent=chosen.size?`⇩ Download selected (${chosen.size})`:'⇩ Download selected'}
function addButton(parent,id,text,fn){if($(id))return;const b=document.createElement('button');b.id=id;b.className='mutate-btn update';b.textContent=text;b.addEventListener('click',fn);parent.appendChild(b)}
function install(){
  const side=document.querySelector('.side');if(!side)return;
  const sep=document.createElement('div');sep.className='action-sep';side.insertBefore(sep,side.querySelector('#newFolder'));
  const holder=document.createElement('div');side.insertBefore(holder,sep);holder.style.display='contents';
  addButton(holder,'dlSelected','⇩ Download selected',()=>{const a=[...chosen.values()];if(!a.length)return note('Check one or more items first.',true);downloadItems(a,`${base(currentPath())}-selected.zip`)});
  addButton(holder,'dlFolder','⇩ Download current folder',()=>downloadItems([{path:currentPath(),name:base(currentPath()),type:'d'}],`${base(currentPath())}.zip`));
  addButton(holder,'dlProject','⇩ Download project…',()=>{const p=prompt('Remote project folder to download as ZIP:',currentPath());if(p?.trim())downloadItems([{path:p.trim(),name:base(p.trim()),type:'d'}],`${base(p.trim())}.zip`)});
  const head=document.querySelector('#rows')?.closest('table')?.querySelector('thead tr');if(head&&!$('dlAll')){const th=document.createElement('th');th.style.cssText='width:28px;padding:6px;text-align:center';const c=document.createElement('input');c.id='dlAll';c.type='checkbox';c.title='Select all visible for download';c.style.cssText='width:16px;height:16px;accent-color:#2788f5';c.onchange=()=>{for(const tr of document.querySelectorAll('#rows tr')){const cb=tr.querySelector('td:first-child input[type=checkbox]');if(cb&&cb.checked!==c.checked){cb.checked=c.checked;cb.dispatchEvent(new MouseEvent('click',{bubbles:true}))}}};th.appendChild(c);head.insertBefore(th,head.firstChild)}
  refreshRows();new MutationObserver(refreshRows).observe($('rows'),{childList:true});
  document.addEventListener('click',e=>{const b=e.target.closest?.('#download');if(!b)return;const item=selectedPreview();if(!item)return;e.preventDefault();e.stopImmediatePropagation();downloadItems([item],item.type==='d'?`${item.name}.zip`:item.name)},true);
  note('Download tools ready: file save picker, folder/project ZIP, and multi-select.');
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
})();