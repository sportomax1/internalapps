(()=>{"use strict";
const file=document.getElementById("file"),input=document.getElementById("input"),message=document.getElementById("message");
const previous=file.onchange;
file.onchange=async()=>{
 const selected=file.files?.[0];if(!selected)return;
 const bytes=new Uint8Array(await selected.slice(0,12).arrayBuffer());
 const header=String.fromCharCode(...bytes.slice(0,4));
 if(header==="AEA1"){
  document.getElementById("filename").textContent=selected.name;
  input.value="";document.getElementById("output").value="";
  message.textContent="Signed Apple Shortcut detected (AEA1). This is a valid signed archive, not a corrupt file. The browser decoder cannot extract its Apple Archive payload yet. Use an iCloud share link for decoding, or extract with macOS aea + aa tools. This file cannot be decoded as a raw plist.";
  message.className="message error";return;
 }
 if(header==="PK\\x03\\x04"){message.textContent="ZIP archive detected, not a Shortcut plist.";message.className="message error";return}
 return previous?.();
};
})();