is.i];if(v!==undefined&&x!==v)throw Error(`Expected "${v}" but found "${x??"end of code"}"`);this.i++;return x}
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
function applyTransform(mesh,n){
  const p=n._translate||[0,0,0],r=n._rotate||[0,0,0],s=n._scale||[1,1,1];
  mesh.position.set(...p);mesh.rotation.set(r[0]*Math.PI/180,r[1]*Math.PI/180,r[2]*Math.PI/180);
  mesh.scale.set(...s);mesh.updateMatrixWorld(true);return mesh;
}
function cloneBrush(b){const c=new Brush(b.geometry.clone(),b.material);c.matrix.copy(b.matrix);c.matrix.decompose(c.position,c.quaternion,c.scale);c.updateMatrixWorld(true);return c}

function compileNode(n, inherited={}){
  const name=n.name.toLowerCase();
  if(name==="cube"){
    const s=vec(arg(n,"size",0,1),[1,1,1]),center=arg(n,"center",1,false);
    const b=brushFromGeometry(new THREE.BoxGeometry(...s),material(inherited.color,inherited.opacity));
    if(!center)b.position.set(s[0]/2,s[1]/2,s[2]/2);b.updateMatrixWorld(true);return b;
  }
  if(name==="sphere"){
    const r=arg(n,"r",0,arg(n,"d",0,2)/2),seg=Math.max(8,Math.min(96,Number(inherited.fn||32)));
    return brushFromGeometry(new THREE.SphereGeometry(r,seg,Math.max(6,seg/2)),material(inherited.color,inherited.opa