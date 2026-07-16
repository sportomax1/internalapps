import * as THREE from "https://esm.sh/three@0.180.0";
import { OrbitControls } from "https://esm.sh/three@0.180.0/examples/jsm/controls/OrbitControls.js";
import { ConvexGeometry } from "https://esm.sh/three@0.180.0/examples/jsm/geometries/ConvexGeometry.js";
import { FontLoader } from "https://esm.sh/three@0.180.0/examples/jsm/loaders/FontLoader.js";
import { TextGeometry } from "https://esm.sh/three@0.180.0/examples/jsm/geometries/TextGeometry.js";
import { Brush, Evaluator, SUBTRACTION, ADDITION, INTERSECTION } from "https://esm.sh/three-bvh-csg@0.0.17";

const $ = s => document.querySelector(s);
const codeEl = $("#code"), logEl = $("#console"), statsEl = $("#stats"), emptyEl = $("#empty");
const statusEl = $("#status"), renderBtn = $("#renderBtn");
const evaluator = new Evaluator();
evaluator.attributes = ["position","normal"];

let previewFont = null;
let fontLoadError = null;
const fontReady = new FontLoader()
  .loadAsync("https://threejs.org/examples/fonts/helvetiker_bold.typeface.json")
  .then(font => {
    previewFont = font;
    statusEl.textContent = "Ready";
    return font;
  })
  .catch(err => {
    fontLoadError = err;
    console.error("Preview font failed to load:", err);
    return null;
  });

const examples = {
box:`$fn = 48;

outer_w = 70;
outer_l = 96;
outer_h = 30;
wall = 3;

difference() {
  cube([outer_w, outer_l, outer_h], center=true);

  translate([0, 0, wall])
    cube([
      outer_w - wall*2,
      outer_l - wall*2,
      outer_h
    ], center=true);
}`,
dice:`$fn = 48;
size = 30;

difference() {
  cube([size,size,size], center=true);

  translate([0,0,size/2])
    cylinder(h=3, r=2.2, center=true);

  translate([-7,7,size/2])
    cylinder(h=3, r=2.2, center=true);

  translate([7,-7,size/2])
    cylinder(h=3, r=2.2, center=true);
}`,
stack:`$fn = 48;

union() {
  color("seagreen")
    cylinder(h=12, r=22, center=true);

  translate([0,0,13])
    difference() {
      sphere(r=17);
      translate([0,0,10])
        cube([40,40,20], center=true);
    }

  translate([0,0,-12])
    rotate([0,0,45])
      cube([24,24,8], center=true);
}`,
poly:`polyhedron(
  points=[
    [-20,-20,0],
    [ 20,-20,0],
    [ 20, 20,0],
    [-20, 20,0],
    [  0,  0,35]
  ],
  faces=[
    [0,3,2,1],
    [0,1,4],
    [1,2,4],
    [2,3,4],
    [3,0,4]
  ]
);`
};

codeEl.value = localStorage.getItem("openscad-code") || examples.box;

let scene, camera, renderer, controls, modelGroup, grid, wireframe=false;
let currentBounds = new THREE.Box3();
init3D();

function init3D(){
  const host=$("#viewport");
  scene=new THREE.Scene();
  scene.background=new THREE.Color(0x141922);

  camera=new THREE.PerspectiveCamera(45,1,.1,10000);
  camera.position.set(115,-125,95);

  renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.shadowMap.enabled=true;
  renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  host.appendChild(renderer.domElement);

  controls=new OrbitControls(camera,renderer.domElement);
  controls.enableDamping=true;
  controls.dampingFactor=.08;

  scene.add(new THREE.HemisphereLight(0xddeeff,0x243040,2.1));
  const key=new THREE.DirectionalLight(0xffffff,2.5);
  key.position.set(80,-100,140); key.castShadow=true; scene.add(key);
  const fill=new THREE.DirectionalLight(0x88bbff,1.1);
  fill.position.set(-120,60,50); scene.add(fill);

  grid=new THREE.GridHelper(300,30,0x4b596b,0x28313d);
  grid.rotation.x=Math.PI/2;
  scene.add(grid);

  modelGroup=new THREE.Group(); scene.add(modelGroup);
  addEventListener("resize",resize);
  resize(); animate();
}
function resize(){
  const host=$("#viewport"), w=Math.max(host.clientWidth,1),h=Math.max(host.clientHeight,1);
  renderer.setSize(w,h,false); camera.aspect=w/h; camera.updateProjectionMatrix();
}
function animate(){requestAnimationFrame(animate);controls.update();renderer.render(scene,camera)}

function stripComments(src){
  return src.replace(/\/\*[\s\S]*?\*\//g,"").replace(/\/\/.*$/gm,"");
}
function findMatching(src,start,openChar,closeChar){
  let depth=0,inString=false,escaped=false;
  for(let i=start;i<src.length;i++){
    const c=src[i];
    if(inString){
      if(escaped)escaped=false;
      else if(c==="\\")escaped=true;
      else if(c==='"')inString=false;
      continue;
    }
    if(c==='"'){inString=true;continue}
    if(c===openChar)depth++;
    else if(c===closeChar){
      depth--;
      if(depth===0)return i;
    }
  }
  throw Error(`Missing closing ${closeChar}`);
}
function splitTopLevel(src,delimiter=","){
  const out=[];let start=0,p=0,b=0,c=0,inString=false,escaped=false;
  for(let i=0;i<src.length;i++){
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
    else if(ch===delimiter && p===0 && b===0 && c===0){
      out.push(src.slice(start,i).trim());start=i+1;
    }
  }
  const tail=src.slice(start).trim();
  if(tail)out.push(tail);
  return out;
}
function replaceIdentifier(src,name,value){
  const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  const re=new RegExp(`(^|[^A-Za-z0-9_$])(${escaped})(?![A-Za-z0-9_$])`,"g");

  return src.replace(re,(full,prefix,matched,offset,whole)=>{
    const after=whole.slice(offset+full.length);
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
  take(v){const x=this.t[this.i];if(v!==undefined&&x!==v)throw Error(`Expected "${v}" but found "${x??"end of code"}"`);this.i++;return x}
  eof(){return this.i>=this.t.length}
  parse(){
    const nodes=[];
    while(!this.eof()){
      if(this.peek(";")){this.take();continue}
      const mark=this.i;
      if(/^[A-Za-z_$]/.test(this.peek()||"") && this.t[this.i+1]==="="){
        const name=this.take();this.take("=");this.vars[name]=this.expr();this.take(";");continue;
      }
      this.i=mark; nodes.push(this.statement());
    }
    return nodes;
  }
  statement(){
    const modifiers=[];
    while(["#","%","!","*"].includes(this.peek())) modifiers.push(this.take());
    if(this.peek("{")) return {name:"union",args:{positional:[],named:{}},children:this.block(),modifiers};
    const name=this.take();
    if(!/^[A-Za-z_]/.test(name||""))throw Error(`Expected a shape or transform near "${name}"`);
    const args=this.args();
    let children=[];
    if(this.peek("{")) children=this.block();
    else if(!this.peek(";")) children=[this.statement()];
    else this.take(";");
    return {name,args,children,modifiers};
  }
  block(){this.take("{");const a=[];while(!this.peek("}")){if(this.eof())throw Error("Missing closing }");if(this.peek(";"))this.take();else a.push(this.statement())}this.take("}");return a}
  args(){
    this.take("(");const positional=[],named={};
    while(!this.peek(")")){
      if(/^[A-Za-z_$]/.test(this.peek()||"")&&this.t[this.i+1]==="="){const k=this.take();this.take("=");named[k]=this.expr()}
      else positional.push(this.expr());
      if(this.peek(","))this.take(",");else break;
    }
    this.take(")");return{positional,named};
  }
  expr(min=0){
    let left=this.unary();
    const prec={"+":1,"-":1,"*":2,"/":2,"%":2,"^":3};
    while(prec[this.peek()]>=min){
      const op=this.take(),p=prec[op],right=this.expr(p+(op==="^"?0:1));
      left=calc(left,op,right);
    }
    return left;
  }
  unary(){
    if(this.peek("-")){this.take();const v=this.unary();return mapVal(v,x=>-x)}
    if(this.peek("+")){this.take();return this.unary()}
    if(this.peek("!")){this.take();return !this.unary()}
    return this.primary();
  }
  primary(){
    const x=this.take();
    if(x==="["){const a=[];while(!this.peek("]")){a.push(this.expr());if(this.peek(","))this.take(",");else break}this.take("]");return a}
    if(x==="("){const v=this.expr();this.take(")");return v}
    if(/^"/.test(x))return JSON.parse(x);
    if(/^\d/.test(x)||x?.startsWith("."))return Number(x);
    if(x==="true")return true;if(x==="false")return false;
    if(this.vars[x]!==undefined)return this.vars[x];
    if(/^[A-Za-z_]/.test(x||"")&&this.peek("(")){
      this.take("(");const vals=[];while(!this.peek(")")){vals.push(this.expr());if(this.peek(","))this.take(",");else break}this.take(")");
      return callMath(x,vals);
    }
    throw Error(`Unknown variable or expression "${x}"`);
  }
}
function mapVal(v,f){return Array.isArray(v)?v.map(x=>mapVal(x,f)):f(v)}
function calc(a,op,b){
  if(Array.isArray(a)||Array.isArray(b)){
    const aa=Array.isArray(a)?a:[a],bb=Array.isArray(b)?b:[b],n=Math.max(aa.length,bb.length);
    return Array.from({length:n},(_,i)=>calc(aa[i%aa.length],op,bb[i%bb.length]));
  }
  return op==="+"?a+b:op==="-"?a-b:op==="*"?a*b:op==="/"?a/b:op==="%"?a%b:Math.pow(a,b);
}
function callMath(n,a){
  const m={sin:x=>Math.sin(x*Math.PI/180),cos:x=>Math.cos(x*Math.PI/180),tan:x=>Math.tan(x*Math.PI/180),
    asin:x=>Math.asin(x)*180/Math.PI,acos:x=>Math.acos(x)*180/Math.PI,atan:x=>Math.atan(x)*180/Math.PI,
    sqrt:Math.sqrt,abs:Math.abs,floor:Math.floor,ceil:Math.ceil,round:Math.round,min:Math.min,max:Math.max,pow:Math.pow};
  if(!m[n])throw Error(`Unsupported function "${n}"`);return m[n](...a);
}
const arg=(n,k,i,d)=>n.args.named[k]??n.args.positional[i]??d;
const vec=(v,d=[0,0,0])=>Array.isArray(v)?[v[0]??0,v[1]??0,v[2]??0]:v===undefined?d:[v,v,v];

function material(color=0x64d391,opacity=1){
  return new THREE.MeshStandardMaterial({color,roughness:.42,metalness:.04,transparent:opacity<1,opacity,side:THREE.DoubleSide});
}
function brushFromGeometry(g,mat){
  g.computeVertexNormals();const b=new Brush(g,mat);b.updateMatrixWorld(true);return b;
}
function compileNode(n, inherited={}){
  const name=n.name.toLowerCase();
  if(name==="cube"){
    const s=vec(arg(n,"size",0,1),[1,1,1]),center=arg(n,"center",1,false);
    const b=brushFromGeometry(new THREE.BoxGeometry(...s),material(inherited.color,inherited.opacity));
    if(!center)b.position.set(s[0]/2,s[1]/2,s[2]/2);b.updateMatrixWorld(true);return b;
  }
  if(name==="sphere"){
    const r=arg(n,"r",0,arg(n,"d",0,2)/2),seg=Math.max(8,Math.min(96,Number(inherited.fn||32)));
    return brushFromGeometry(new THREE.SphereGeometry(r,seg,Math.max(6,seg/2)),material(inherited.color,inherited.opacity));
  }
  if(name==="cylinder"){
    const h=arg(n,"h",0,1),r=arg(n,"r",1,null),r1=arg(n,"r1",1,r??1),r2=arg(n,"r2",2,r??r1);
    const center=arg(n,"center",3,false),seg=Math.max(8,Math.min(128,Number(inherited.fn||32)));
    const b=brushFromGeometry(new THREE.CylinderGeometry(r2,r1,h,seg),material(inherited.color,inherited.opacity));
    b.rotation.x=Math.PI/2;if(!center)b.position.z=h/2;b.updateMatrixWorld(true);return b;
  }
  if(name==="polyhedron"){
    const points=arg(n,"points",0,[]);
    const faces=arg(n,"faces",1,arg(n,"triangles",1,[]));
    if(!Array.isArray(points) || points.length < 4) throw Error("polyhedron() requires at least 4 points.");
    if(!Array.isArray(faces) || faces.length < 4) throw Error("polyhedron() requires faces=[...].");
    const positions=[]; const indices=[];
    for(const p of points){
      if(!Array.isArray(p) || p.length < 3) throw Error("Each polyhedron point must be [x, y, z].");
      positions.push(Number(p[0]),Number(p[1]),Number(p[2]));
    }
    for(const face of faces){
      if(!Array.isArray(face) || face.length < 3) throw Error("Each polyhedron face must contain at least 3 point indexes.");
      const a=Number(face[0]);
      for(let i=1;i<face.length-1;i++) indices.push(a,Number(face[i]),Number(face[i+1]));
    }
    const g=new THREE.BufferGeometry();
    g.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));
    g.setIndex(indices);g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();
    return brushFromGeometry(g,material(inherited.color,inherited.opacity));
  }
  if(["translate","rotate","scale","mirror","color"].includes(name)){
    const ctx={...inherited};
    let transforms={t:[0,0,0],r:[0,0,0],s:[1,1,1]};
    if(name==="translate")transforms.t=vec(arg(n,"v",0,[0,0,0]));
    if(name==="rotate")transforms.r=vec(arg(n,"a",0,[0,0,0]));
    if(name==="scale")transforms.s=vec(arg(n,"v",0,[1,1,1]));
    if(name==="mirror"){const v=vec(arg(n,"v",0,[1,0,0]));transforms.s=v.map(x=>x? -1:1)}
    if(name==="color"){
      const c=arg(n,"c",0,"seagreen"),alpha=arg(n,"alpha",1,1);
      ctx.color=new THREE.Color(c).getHex();ctx.opacity=alpha;
    }
    const child=combine(n.children.map(c=>compileNode(c,ctx)).filter(Boolean),"union");
    if(!child)return null;
    child.position.add(new THREE.Vector3(...transforms.t));
    child.rotation.x+=transforms.r[0]*Math.PI/180;child.rotation.y+=transforms.r[1]*Math.PI/180;child.rotation.z+=transforms.r[2]*Math.PI/180;
    child.scale.multiply(new THREE.Vector3(...transforms.s));child.updateMatrixWorld(true);return child;
  }
  if(name==="text"){
    if(!previewFont){
      if(fontLoadError) throw Error("The preview font could not be loaded. Check your internet connection and reopen the file.");
      throw Error("The preview font is still loading. Press Render again.");
    }
    const value=String(arg(n,"text",0,""));
    const size=Number(arg(n,"size",1,10));
    const halign=String(arg(n,"halign",4,"left")).toLowerCase();
    const valign=String(arg(n,"valign",5,"baseline")).toLowerCase();
    const spacing=Number(arg(n,"spacing",3,1));
    const g=new TextGeometry(value,{font:previewFont,size,depth:1,curveSegments:Math.max(3,Math.min(12,Math.round(Number(inherited.fn||32)/8))),bevelEnabled:false});
    g.computeBoundingBox();
    const box=g.boundingBox; const width=(box.max.x-box.min.x)*spacing; const height=box.max.y-box.min.y;
    let offsetX=-box.min.x;
    if(halign==="center") offsetX-=width/2; else if(halign==="right") offsetX-=width;
    let offsetY=0;
    if(valign==="center") offsetY=-(box.min.y+height/2); else if(valign==="top") offsetY=-box.max.y; else if(valign==="bottom") offsetY=-box.min.y;
    g.translate(offsetX,offsetY,0);
    if(spacing!==1){
      const pos=g.getAttribute("position");
      for(let i=0;i<pos.count;i++) pos.setX(i,pos.getX(i)*spacing);
      pos.needsUpdate=true;g.computeBoundingBox();g.computeBoundingSphere();
    }
    return brushFromGeometry(g,material(inherited.color,inherited.opacity));
  }
  if(name==="linear_extrude"){
    const height=Number(arg(n,"height",0,1));
    const center=Boolean(arg(n,"center",1,false));
    const children=n.children.map(c=>compileNode(c,inherited)).filter(Boolean);
    if(!children.length)return null;
    const child=combine(children,"union");
    child.scale.z*=height;
    if(center) child.position.z-=height/2;
    child.updateMatrixWorld(true);
    return child;
  }
  if(name==="hull"){
    const children=n.children.map(c=>compileNode(c,inherited)).filter(Boolean);
    if(!children.length)return null;if(children.length===1)return children[0];
    const pts=[];
    for(const child of children){
      child.updateMatrixWorld(true);
      const pos=child.geometry?.getAttribute("position");if(!pos)continue;
      const step=Math.max(1,Math.floor(pos.count/250));
      for(let i=0;i<pos.count;i+=step) pts.push(new THREE.Vector3().fromBufferAttribute(pos,i).applyMatrix4(child.matrixWorld));
    }
    if(pts.length<4)return combine(children,"union");
    const g=new ConvexGeometry(pts);
    return brushFromGeometry(g,material(inherited.color,inherited.opacity));
  }
  if(["union","difference","intersection"].includes(name))return combine(n.children.map(c=>compileNode(c,inherited)).filter(Boolean),name);
  throw Error(`Unsupported OpenSCAD command "${n.name}"`);
}
function combine(items,mode){
  if(!items.length)return null;if(items.length===1)return items[0];
  let result=items[0];result.updateMatrixWorld(true);
  for(let i=1;i<items.length;i++){
    const next=items[i];next.updateMatrixWorld(true);
    const op=mode==="difference"?SUBTRACTION:mode==="intersection"?INTERSECTION:ADDITION;
    result=evaluator.evaluate(result,next,op);
    result.material=items[0].material;result.updateMatrixWorld(true);
  }
  return result;
}
function compile(src){
  const p=new Parser(src),nodes=p.parse(),ctx={fn:p.vars.$fn||32,color:0x64d391,opacity:1};
  return {mesh:combine(nodes.map(n=>compileNode(n,ctx)).filter(Boolean),"union"),vars:p.vars,nodes};
}
function clearModel(){
  while(modelGroup.children.length){const o=modelGroup.children.pop();o.geometry?.dispose();if(Array.isArray(o.material))o.material.forEach(m=>m.dispose());else o.material?.dispose()}
}
async function renderCode(){
  const start=performance.now();renderBtn.disabled=true;statusEl.textContent="Loading font…";
  try{
    await fontReady;
    statusEl.textContent="Compiling…";
    clearModel();const out=compile(codeEl.value);
    if(!out.mesh)throw Error("No renderable geometry was produced.");
    const mesh=out.mesh;
    mesh.castShadow=true;mesh.receiveShadow=true;mesh.material.wireframe=wireframe;
    modelGroup.add(mesh);
    currentBounds.setFromObject(modelGroup);
    const size=currentBounds.getSize(new THREE.Vector3());
    const ms=(performance.now()-start).toFixed(0);
    statsEl.textContent=`${size.x.toFixed(1)} × ${size.y.toFixed(1)} × ${size.z.toFixed(1)} mm • ${ms} ms`;
    logEl.innerHTML=`<span class="ok">Render successful.</span><br>Supported: custom modules, array for-loops, hull, text engravings, linear_extrude, variables, arithmetic, cube, sphere, cylinder, polyhedron, translate, rotate, scale, mirror, color, union, difference and intersection.`;
    emptyEl.style.display="none";statusEl.textContent="Rendered";localStorage.setItem("openscad-code",codeEl.value);fitCamera();
  }catch(e){
    console.error(e);logEl.innerHTML=`<span class="err">Render error:</span> ${escapeHtml(e.message)}<br><span class="warn">This lightweight viewer is not the complete desktop OpenSCAD engine. Custom modules, array for-loops, hull(), text() and linear_extrude() are supported. The preview substitutes a browser-safe bold font when the exact OpenSCAD font is unavailable; minkowski() and imports remain unsupported.</span>`;
    statusEl.textContent="Error";statsEl.textContent="Render failed";
  }finally{renderBtn.disabled=false}
}
function fitCamera(view="iso"){
  if(currentBounds.isEmpty())return;
  const center=currentBounds.getCenter(new THREE.Vector3()),size=currentBounds.getSize(new THREE.Vector3());
  const radius=Math.max(size.x,size.y,size.z)*1.25||10;
  const dirs={iso:[1.15,-1.3,.95],front:[0,-1,0],top:[0,0,1],right:[1,0,0]};
  const d=new THREE.Vector3(...(dirs[view]||dirs.iso)).normalize();
  camera.position.copy(center).addScaledVector(d,radius*2.2);camera.near=Math.max(.01,radius/100);camera.far=radius*100;
  camera.updateProjectionMatrix();controls.target.copy(center);controls.update();
}
function escapeHtml(s){return s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}

renderBtn.onclick=renderCode;
$("#fitBtn").onclick=()=>fitCamera();
document.querySelectorAll("[data-view]").forEach(b=>b.onclick=()=>fitCamera(b.dataset.view));
$("#gridBtn").onclick=()=>grid.visible=!grid.visible;
$("#wireBtn").onclick=()=>{wireframe=!wireframe;modelGroup.traverse(o=>{if(o.isMesh)o.material.wireframe=wireframe})};
$("#exampleSelect").onchange=e=>{if(examples[e.target.value]){codeEl.value=examples[e.target.value];renderCode()}e.target.value=""};
$("#saveBtn").onclick=()=>{const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([codeEl.value],{type:"text/plain"}));a.download="model.scad";a.click();URL.revokeObjectURL(a.href)};
$("#openBtn").onclick=()=>$("#fileInput").click();
$("#fileInput").onchange=async e=>{const f=e.target.files[0];if(f){codeEl.value=await f.text();renderCode()}};
codeEl.addEventListener("keydown",e=>{
  if(e.key==="Tab"){e.preventDefault();const s=codeEl.selectionStart,end=codeEl.selectionEnd;codeEl.setRangeText("  ",s,end,"end")}
  if((e.ctrlKey||e.metaKey)&&e.key==="Enter"){e.preventDefault();renderCode()}
});
$("#tabCode").onclick=()=>document.body.classList.remove("preview-mode");
$("#tabPreview").onclick=()=>{document.body.classList.add("preview-mode");setTimeout(resize,0)};

let dragging=false;
$("#splitter").addEventListener("mousedown",()=>dragging=true);
addEventListener("mouseup",()=>dragging=false);
addEventListener("mousemove",e=>{
  if(!dragging)return;
  const ws=$("#workspace"),r=ws.getBoundingClientRect(),pct=Math.max(25,Math.min(70,(e.clientX-r.left)/r.width*100));
  ws.style.gridTemplateColumns=`minmax(330px,${pct}%) 7px 1fr`;resize();
});

renderCode();