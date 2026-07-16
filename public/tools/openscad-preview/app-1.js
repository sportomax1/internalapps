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
  const esc