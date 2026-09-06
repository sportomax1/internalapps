import crypto from 'node:crypto';
import path from 'node:path';
import SftpClient from 'ssh2-sftp-client';

export const config = { maxDuration: 300 };
const HOST='1.studio.boardgamearena.com', PORT=2022;
const secret=()=>String(process.env.APP_PASSWORD||process.env.PERSONAL_PASSWORD||'');
const eq=(a,b)=>{const x=Buffer.from(String(a??'')),y=Buffer.from(String(b??''));return x.length===y.length&&crypto.timingSafeEqual(x,y)};
function tokenOK(token){const s=secret();if(!s||!token)return false;const p=String(token).split('.');if(p.length!==2)return false;const sig=crypto.createHmac('sha256',s).update(p[0]).digest('base64url');if(!eq(sig,p[1]))return false;try{return Number(JSON.parse(Buffer.from(p[0],'base64url').toString()).exp)>Date.now()}catch{return false}}
function key(raw){const v=String(raw||'');return v.includes('\\n')&&!v.includes('\n')?v.replace(/\\n/g,'\n'):v}
function auth(body){const mode=String(body.authMode||'manual').toLowerCase(), supplied=String(body.username||'').trim();if(secret()&&!tokenOK(body.appToken)&&!eq(body.appPassword,secret()))throw Object.assign(new Error('Incorrect or expired Internal Apps password.'),{statusCode:401});if(mode==='saved'){const username=supplied||String(process.env.SFTP_USERNAME||process.env.SFTP_USER||'').trim(),pk=key(process.env.SFTP_PRIVATE_KEY),pw=String(process.env.SFTP_PASSWORD||''),method=String(process.env.SFTP_AUTH_METHOD||'').toLowerCase();if(!username)throw new Error('SFTP username is not configured.');if(method==='key'||(!method&&pk))return{username,privateKey:pk,passphrase:process.env.SFTP_PASSPHRASE||undefined};if(pw)return{username,password:pw};throw new Error('Saved SFTP authentication is not configured.')}const username=supplied,password=String(body.password||'');if(!username||!password)throw Object.assign(new Error('SFTP username and password are required.'),{statusCode:400});return{username,password}}
export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'Method not allowed.'});
  const target=String(req.body?.path||'').trim();if(!target||target.includes('\0'))return res.status(400).json({ok:false,error:'Invalid remote path.'});
  let client;
  try{
    const a=auth(req.body||{});client=new SftpClient('internalapps-stream');
    await client.connect({host:HOST,port:PORT,username:a.username,password:a.password,privateKey:a.privateKey,passphrase:a.passphrase,readyTimeout:12000,keepaliveInterval:5000,keepaliveCountMax:2});
    const stat=await client.stat(target);if(stat.isDirectory)throw Object.assign(new Error('Cannot stream a directory directly.'),{statusCode:400});
    const filename=path.posix.basename(target)||'download.bin';
    res.statusCode=200;res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/octet-stream');res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);res.setHeader('Content-Length',String(stat.size));
    const stream=client.createReadStream(target,{autoClose:true});
    await new Promise((resolve,reject)=>{stream.on('error',reject);res.on('error',reject);res.on('close',resolve);stream.on('end',resolve);stream.pipe(res)});
    if(!res.writableEnded)res.end();
  }catch(e){if(!res.headersSent)return res.status(Number(e.statusCode)||502).json({ok:false,error:String(e.message||e).slice(0,500)});try{res.destroy(e)}catch{}}
  finally{if(client)try{await client.end()}catch{}}
}
