(()=>{"use strict";
const main=document.querySelector("main"),workspace=document.querySelector(".workspace"),msg=document.getElementById("message");
const section=document.createElement("section");section.className="pane";section.style.margin="14px 0";
section.innerHTML=`<div class="heading"><h2>Workflow environment</h2></div>
<div class="actions" role="group" aria-label="Choose workflow environment"><button type="button" id="mode-web" class="primary" aria-pressed="true">No Mac</button><button type="button" id="mode-mac" aria-pressed="false">MacBook</button></div>
<p id="environment-summary" style="margin:10px 0">Convert JSON, XML and unsigned plists in your browser. Shared iCloud links can be fetched by the server. Creating an installable signed Shortcut is not supported in this mode.</p>
<div id="mac-instructions" hidden>
<p><strong>MacBook: signed file → JSON</strong>. Download the signed .shortcut to your Mac. The simplest tested community path is <a href="https://github.com/Wuvomi/shortcut-cli" target="_blank" rel="noopener">shortcut-cli</a>:</p>
<pre style="overflow:auto;white-space:pre-wrap;background:#0c1425;border-radius:9px;padding:12px;font-size:12px" id="mac-decode">python3 shortcut_cli.py decompile "Input.shortcut" -o "Input.json"</pre>
<button type="button" id="copy-decode">Copy decode command</button>
<p><strong>JSON → signed, installable .shortcut</strong>. Convert JSON to a binary workflow here, save the unsigned file, then sign it on the Mac using Apple's built-in command:</p>
<pre style="overflow:auto;white-space:pre-wrap;background:#0c1425;border-radius:9px;padding:12px;font-size:12px" id="mac-sign">shortcuts sign --mode anyone --input "Shortcut.wflow" --output "Shortcut.shortcut"</pre>
<button type="button" id="copy-sign">Copy signing command</button>
<p class="note">MacBook signing requires Shortcuts support and may contact Apple for validation. You must review and confirm import on your iPhone. The command does not repair invalid action identifiers or parameters. For decoding, install shortcut-cli from its repository first.</p>
</div>
<p class="note" id="web-limits">No Mac: unsigned workflows are editable source, not guaranteed iPhone-installable shortcuts. AEA1 signed-file decoding and Apple signing are not implemented on this website. You can still inspect shared iCloud workflows when the fetch endpoint returns an unsigned plist.</p>`;
main.insertBefore(section,workspace);
const web=document.getElementById("mode-web"),mac=document.getElementById("mode-mac"),instructions=document.getElementById("mac-instructions"),limits=document.getElementById("web-limits"),summary=document.getElementById("environment-summary");
function setMode(isMac){web.classList.toggle("primary",!isMac);mac.classList.toggle("primary",isMac);web.setAttribute("aria-pressed",String(!isMac));mac.setAttribute("aria-pressed",String(isMac));instructions.hidden=!isMac;limits.hidden=isMac;summary.textContent=isMac?"Convert in the browser; use your Mac to decode AEA1 archives and sign installable .shortcut files. Commands below.":"Convert JSON, XML and unsigned plists in your browser. Shared iCloud links can be fetched by the server. Creating an installable signed Shortcut is not supported in this mode."}
web.onclick=()=>setMode(false);mac.onclick=()=>setMode(true);
for(const [button,pre] of [["copy-decode","mac-decode"],["copy-sign","mac-sign"]])document.getElementById(button).onclick=async()=>{try{await navigator.clipboard.writeText(document.getElementById(pre).textContent);msg.textContent="Command copied.";msg.className="message"}catch(e){msg.textContent="Clipboard unavailable. Select and copy the command manually.";msg.className="message error"}};
const previousMakeFile=makeFile;
makeFile=function(){const f=previousMakeFile();if(document.getElementById("outputType").value!=="binary")return f;return new File([f],f.name.replace(/\.plist$/i,".wflow"),{type:"application/octet-stream"})};
})();