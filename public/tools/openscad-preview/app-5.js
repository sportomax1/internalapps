en,"union");
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