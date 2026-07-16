aped=name.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  const re=new RegExp(`(^|[^A-Za-z0-9_$])(${escaped})(?![A-Za-z0-9_$])`,"g");

  return src.replace(re,(full,prefix,matched,offset,whole)=>{
    const after=whole.slice(offset+full.length);

    // Do not replace a named-argument key such as:
    // cylinder(h = h, r = r)
    // Only replace the value-side identifier.
    if(/^\s*=/.test(after)) return full;

    return `${prefix}(${value})`;
  });
}
function expandForLoops(src){
  let passes=0;
  while(/\bfor\s*\(/.test(src) && passes++<200){
    const re=/\bfor\s*\(\s*([A-Za-z_$]\w*)\s*=\s*/g;
    const m=re.exec(src);
    if(!m)break;

    const varName=m[1];
    const openParen=src.indexOf("(",m.index);
    const closeParen=findMatching(src,openParen,"(",")");
    const assignText=src.slice(openParen+1,closeParen);
    const eq=assignText.indexOf("=");
    const valuesText=assignText.slice(eq+1).trim();

    if(!valuesText.startsWith("["))
      throw Error(`Only array-based for loops are supported: for (${varName} = [...])`);

    const arrEnd=findMatching(valuesText,0,"[","]");
    const values=splitTopLevel(valuesText.slice(1,arrEnd));

    let bodyStart=closeParen+1;
    while(/\s/.test(src[bodyStart]||""))bodyStart++;

    let body="", end=bodyStart;
    if(src[bodyStart]==="{"){
      const bodyEnd=findMatching(src,bodyStart,"{","}");
      body=src.slice(bodyStart+1,bodyEnd);
      end=bodyEnd+1;
    }else{
      // Capture one complete OpenSCAD statement, including nested transforms.
      let p=0,b=0,c=0,inString=false,escaped=false;
      for(let i=bodyStart;i<src.length;i++){
        const ch=src[i];
        if(inString){
          if(escaped)escaped=false;
          else if(ch==="\\")escaped=true;
          else if(ch==='"')inString=false;
          continue;
        }
        if(ch==='"'){inString=true;continue}
        if(ch==="(")p++; else if(ch===")")p--;
        else if(ch==="[")b++; else if(ch==="]")b--;
        else if(ch==="{")c++; else if(ch==="}")c--;
        else if(ch===";" && p===0 && b===0 && c===0){
          end=i+1;break;
        }
      }
      body=src.slice(bodyStart,end);
    }

    const expanded=values.map(v=>replaceIdentifier(body,varName,v)).join("\n");
    src=src.slice(0,m.index)+expanded+src.slice(end);
  }
  if(passes>=200)throw Error("For-loop expansion exceeded the safety limit.");
  return src;
}
function preprocessModules(source){
  let src=stripComments(source);
  const modules=new Map();
  const moduleRe=/\bmodule\s+([A-Za-z_]\w*)\s*\(/g;
  let match;

  while((match=moduleRe.exec(src))){
    const name=match[1];
    const openParen=src.indexOf("(",match.index);
    const closeParen=findMatching(src,openParen,"(",")");
    let braceStart=closeParen+1;
    while(/\s/.test(src[braceStart]||""))braceStart++;
    if(src[braceStart]!=="{")throw Error(`Expected "{" after module ${name} parameters`);
    const braceEnd=findMatching(src,braceStart,"{","}");

    const paramText=src.slice(openParen+1,closeParen);
    const params=splitTopLevel(paramText).map(entry=>{
      const eq=entry.indexOf("=");
      return eq<0
        ? {name:entry.trim(),defaultValue:null}
        : {name:entry.slice(0,eq).trim(),defaultValue:entry.slice(eq+1).trim()};
    }).filter(p=>p.name);

    modules.set(name,{params,body:src.slice(braceStart+1,braceEnd)});
    src=src.slice(0,match.index)+src.slice(braceEnd+1);
    moduleRe.lastIndex=match.index;
  }

  let changed=true,passes=0;
  while(changed && passes++<100){
    changed=false;
    for(const [name,def] of modules){
      const callRe=new RegExp(`\\b${name}\\s*\\(`,"g");
      let m;
      while((m=callRe.exec(src))){
        const openParen=src.indexOf("(",m.index);
        const closeParen=findMatching(src,openParen,"(",")");
        const rawArgs=splitTopLevel(src.slice(openParen+1,closeParen));
        const positional=[];
        const named={};

        for(const item of rawArgs){
          const eq=item.indexOf("=");
          if(eq>0 && /^[A-Za-z_$]\w*$/.test(item.slice(0,eq).trim()))
            named[item.slice(0,eq).trim()]=item.slice(eq+1).trim();
          else positional.push(item);
        }

        let body=def.body;
        let posIndex=0;
        for(const param of def.params){
          const value=named[param.name] ?? positional[posIndex++] ?? param.defaultValue;
          if(value==null)throw Error(`Missing parameter "${param.name}" in ${name}()`);
          body=replaceIdentifier(body,param.name,value);
        }

        let end=closeParen+1;
        while(/\s/.test(src[end]||""))end++;
        if(src[end]===";")end++;

        src=src.slice(0,m.index)+`union(){${body}}`+src.slice(end);
        changed=true;
        callRe.lastIndex=m.index;
      }
    }
  }

  if(passes>=100)throw Error("Module expansion exceeded the safety limit.");
  return expandForLoops(src);
}
function tokenize(src){
  src=preprocessModules(src);
  const re=/(?:\d*\.\d+|\d+\.?\d*)(?:[eE][+-]?\d+)?|"(?:\\.|[^"])*"|[A-Za-z_$][\w$]*|==|!=|<=|>=|&&|\|\||[+\-*/%^=;,()[\]{}<>!?:]/g;
  return src.match(re)||[];
}
class Parser{
  constructor(src){this.t=tokenize(src);this.i=0;this.vars={$fn:32,PI:Math.PI};}
  peek(v){return v===undefined?this.t[this.i]:this.t[this.i]===v}
  take(v){const x=this.t[th