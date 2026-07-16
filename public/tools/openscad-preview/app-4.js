city));
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

    if(!Array.isArray(points) || points.length < 4)
      throw Error("polyhedron() requires at least 4 points.");

    if(!Array.isArray(faces) || faces.length < 4)
      throw Error("polyhedron() requires faces=[...].");

    const positions=[];
    const indices=[];

    for(const p of points){
      if(!Array.isArray(p) || p.length < 3)
        throw Error("Each polyhedron point must be [x, y, z].");
      positions.push(Number(p[0]),Number(p[1]),Number(p[2]));
    }

    for(const face of faces){
      if(!Array.isArray(face) || face.length < 3)
        throw Error("Each polyhedron face must contain at least 3 point indexes.");

      const a=Number(face[0]);
      for(let i=1;i<face.length-1;i++){
        indices.push(a,Number(face[i]),Number(face[i+1]));
      }
    }

    const g=new THREE.BufferGeometry();
    g.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));
    g.setIndex(indices);
    g.computeVertexNormals();
    g.computeBoundingBox();
    g.computeBoundingSphere();

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

    const g=new TextGeometry(value,{
      font:previewFont,
      size,
      depth:1,
      curveSegments:Math.max(3,Math.min(12,Math.round(Number(inherited.fn||32)/8))),
      bevelEnabled:false
    });

    g.computeBoundingBox();
    const box=g.boundingBox;
    const width=(box.max.x-box.min.x)*spacing;
    const height=box.max.y-box.min.y;

    let offsetX=-box.min.x;
    if(halign==="center") offsetX-=width/2;
    else if(halign==="right") offsetX-=width;

    let offsetY=0;
    if(valign==="center") offsetY=-(box.min.y+height/2);
    else if(valign==="top") offsetY=-box.max.y;
    else if(valign==="bottom") offsetY=-box.min.y;
    else offsetY=0;

    g.translate(offsetX,offsetY,0);

    if(spacing!==1){
      const pos=g.getAttribute("position");
      for(let i=0;i<pos.count;i++) pos.setX(i,pos.getX(i)*spacing);
      pos.needsUpdate=true;
      g.computeBoundingBox();
      g.computeBoundingSphere();
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
    if(!children.length)return null;
    if(children.length===1)return children[0];

    const pts=[];
    for(const child of children){
      child.updateMatrixWorld(true);
      const pos=child.geometry?.getAttribute("position");
      if(!pos)continue;
      const step=Math.max(1,Math.floor(pos.count/250));
      for(let i=0;i<pos.count;i+=step){
        const v=new THREE.Vector3().fromBufferAttribute(pos,i).applyMatrix4(child.matrixWorld);
        pts.push(v);
      }
    }
    if(pts.length<4)return combine(childr