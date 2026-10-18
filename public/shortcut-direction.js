(()=>{"use strict";
const $=id=>document.getElementById(id),input=$("input"),outputType=$("outputType");
const bar=document.createElement("div");bar.className="footer";bar.style.margin="8px 0 14px";
bar.innerHTML='<label for="conversion-mode">Direction</label><select id="conversion-mode"><option value="auto">Auto detect</option><option value="decode">Decode → JSON/XML</option><option value="encode">Encode → plist</option></select><small id="conversion-hint"></small>';
document.querySelector(".workspace").before(bar);
const mode=$("conversion-mode"),hint=$("conversion-hint");
function kind(){const t=input.value.trim();if(/^https:\/\/(?:www\.)?icloud\.com\/shortcuts\/[a-f0-9]{32}(?:[/?#]|$)/i.test(t))return "url";if(t.startsWith("YnBsaXN0MDA"))return "binary";if(t.startsWith("{")||t.startsWith("["))return "json";if(t.startsWith("<"))return "xml";return "unknown"}
function refresh(){const k=kind();const direction=mode.value==="auto"?(k==="binary"||k==="url"?"decode":"encode"):mode.value;hint.textContent=direction==="decode"?"Shortcut → JSON/XML":"JSON/XML → binary plist";if(direction==="decode"&&outputType.value==="binary")outputType.value="json";if(direction==="encode"&&outputType.value==="json")outputType.value="binary"}
mode.onchange=refresh;input.addEventListener("input",refresh);$("file").addEventListener("change",()=>setTimeout(refresh,100));refresh();
const convert=$("convert").onclick;
$("convert").onclick=()=>{const k=kind();if(k==="url"){const field=$("icloud-link");if(!field)return;field.value=input.value.trim();$("icloud-import").click();return}if(mode.value==="decode"&&k==="json"){const m=$("message");m.textContent="Decode mode expects a plist or iCloud link. Switch to Auto detect to encode JSON.";m.classList.add("error");return}if(mode.value==="encode"&&k==="binary"){const m=$("message");m.textContent="Encode mode expects JSON/XML. Switch to Decode for binary plist.";m.classList.add("error");return}convert()};
})();