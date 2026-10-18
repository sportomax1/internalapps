// Fetch a public iCloud Shortcut through a same-origin endpoint (avoids browser CORS).
const ID=/^[a-f0-9]{32}$/i;
export default async function handler(req,res){
 res.setHeader("Cache-Control","no-store");
 if(req.method!=="GET")return res.status(405).json({error:"GET only"});
 const id=String(req.query.id||"").trim();
 if(!ID.test(id))return res.status(400).json({error:"Invalid iCloud Shortcut ID"});
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),12000);
 try{
  const metadata=await fetch("https://www.icloud.com/shortcuts/api/records/"+id,{signal:controller.signal,headers:{"Accept":"application/json"}});
  if(!metadata.ok)throw Error("iCloud metadata request failed ("+metadata.status+")");
  const record=await metadata.json();
  const item=record.records?.[0]||record;
  const link=item.fields?.shortcut?.value?.downloadURL||item.fields?.shortcut?.value?.downloadUrl||item.shortcut?.downloadURL||item.downloadURL;
  const name=item.fields?.name?.value||item.fields?.name?.value?.text||item.name||"iCloud Shortcut";
  if(typeof link!=="string")throw Error("iCloud did not return a shortcut download link");
  const url=new URL(link);
  if(url.protocol!=="https:"||!["icloud.com","apple.com","icloud-content.com","apple-cloudkit.com","cdn-apple.com"].some(h=>url.hostname===h||url.hostname.endsWith("."+h)))throw Error("Unexpected iCloud download host: "+url.hostname);
  const download=await fetch(url,{signal:controller.signal});
  if(!download.ok)throw Error("Shortcut download failed ("+download.status+")");
  const size=Number(download.headers.get("content-length")||0);
  if(size>8*1024*1024)throw Error("Shortcut exceeds 8 MB");
  const bytes=Buffer.from(await download.arrayBuffer());
  if(bytes.length>8*1024*1024)throw Error("Shortcut exceeds 8 MB");
  if(bytes.subarray(0,8).toString()!=="bplist00"&&!bytes.toString("utf8",0,160).includes("<plist"))throw Error("Downloaded shortcut uses an unsupported format (possibly Apple signed wrapper).");
  return res.status(200).json({name,base64:bytes.toString("base64"),format:bytes.subarray(0,8).toString()==="bplist00"?"binary":"xml"});
 }catch(e){return res.status(502).json({error:e.name==="AbortError"?"iCloud request timed out":e.message||"Unable to retrieve shortcut"})}
 finally{clearTimeout(timer)}
}
