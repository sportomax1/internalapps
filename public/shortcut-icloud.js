(()=>{"use strict";
const input=document.getElementById("input"),output=document.getElementById("output"),file=document.getElementById("file"),type=document.getElementById("inputType"),message=document.getElementById("message");
const wrapper=document.createElement("div");wrapper.className="footer";wrapper.style.cssText="margin-bottom:12px;gap:8px";
wrapper.innerHTML='<input id="icloud-link" type="url" inputmode="url" aria-label="iCloud Shortcut URL" placeholder="Paste iCloud Shortcut link…" style="flex:1;min-width:140px;padding:10px;background:#0c1425;color:#fff;border:1px solid #384965;border-radius:9px"><button id="icloud-import" type="button">Import Link</button>';
input.parentElement.insertBefore(wrapper,input);
const btn=document.getElementById("icloud-import"),field=document.getElementById("icloud-link");
btn.onclick=async()=>{
 const match=field.value.trim().match(/^(?:https:\/\/)?(?:www\.)?icloud\.com\/shortcuts\/([a-f0-9]{32})(?:[/?#].*)?$/i);
 if(!match){message.textContent="Enter a valid iCloud Shortcut share URL.";message.className="message error";return}
 btn.disabled=true;btn.textContent="Importing…";message.textContent="Retrieving shared Shortcut from iCloud…";message.className="message";
 try{
  const res=await fetch("/api/shortcut-import?id="+encodeURIComponent(match[1]),{headers:{"Accept":"application/json"}});
  const data=await res.json();if(!res.ok)throw Error(data.error||"iCloud import failed");
  if(data.format==="binary"){input.value=data.base64;type.value="auto"}else{const bytes=Uint8Array.from(atob(data.base64),x=>x.charCodeAt(0));input.value=new TextDecoder().decode(bytes);type.value="xml"}
  input.dispatchEvent(new Event("input",{bubbles:true}));output.value="";
  document.getElementById("filename").textContent=data.name||"iCloud Shortcut";
  message.textContent="Imported "+(data.name||"iCloud Shortcut")+". Click Convert to view JSON, XML or binary plist.";message.className="message";
 }catch(e){message.textContent=e.message+" — You can still import a local .shortcut file.";message.className="message error"}
 finally{btn.disabled=false;btn.textContent="Import Link"}
};
})();