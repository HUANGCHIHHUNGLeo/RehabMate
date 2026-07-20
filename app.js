import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MUSCLES } from './muscles.js';
// Model: "Male base muscular anatomy" by CharacterZone (CC-BY) via Sketchfab

const app = document.getElementById('app');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf4f6f8);
scene.fog = new THREE.FogExp2(0xeef1f5, 0.02);

const camera = new THREE.PerspectiveCamera(42, innerWidth/innerHeight, 0.1, 100);
camera.position.set(0, 1.15, 5.4);

const renderer = new THREE.WebGLRenderer({antialias:true, alpha:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
app.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.target.set(0, 1.02, 0);
controls.minDistance = 2.6; controls.maxDistance = 8;
controls.maxPolarAngle = Math.PI*0.92; controls.minPolarAngle = Math.PI*0.08;
controls.autoRotate = false; // patient needs a still body to point at
controls.rotateSpeed = 1.1;      // snappier drag on touch
controls.enablePan = false;      // no accidental panning; one finger = rotate, two = zoom
controls.zoomSpeed = 1.2;
controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

// ---- lighting: bright neutral studio (white theme) ----
scene.add(new THREE.HemisphereLight(0xffffff, 0xd8dee8, 1.05));
scene.add(new THREE.AmbientLight(0xffffff, 0.45));
const key = new THREE.DirectionalLight(0xffffff, 1.5); key.position.set(3,5,4); scene.add(key);
const fill = new THREE.DirectionalLight(0xeaf0ff, 0.8); fill.position.set(-5,2,3); scene.add(fill);
const rimB = new THREE.DirectionalLight(0xcdd8ea, 0.6); rimB.position.set(0,3,-5); scene.add(rimB);

// ---- ground: soft scanner ring (light) ----
const ring = new THREE.Mesh(
  new THREE.RingGeometry(0.9, 1.55, 96),
  new THREE.MeshBasicMaterial({color:0x2f6bff, transparent:true, opacity:0.07, side:THREE.DoubleSide})
);
ring.rotation.x = -Math.PI/2; ring.position.y = 0.01; scene.add(ring);
const ring2 = new THREE.Mesh(
  new THREE.RingGeometry(1.6, 1.63, 96),
  new THREE.MeshBasicMaterial({color:0x2f6bff, transparent:true, opacity:0.28, side:THREE.DoubleSide})
);
ring2.rotation.x = -Math.PI/2; ring2.position.y = 0.01; scene.add(ring2);
const grid2 = new THREE.GridHelper(9, 30, 0xc4cedd, 0xdde3ec);
grid2.position.y = 0; grid2.material.transparent = true; grid2.material.opacity = 0.6; scene.add(grid2);

// ---- anatomical zones used to name the exact pin location ----
// Anatomical zone centers (T-pose). Every body vertex is assigned to its nearest
// zone so pins can display a useful anatomical label.
// [name, side, x, y, z, rx, ry, rz]  (rx/ry/rz weight the zone's reach per axis)
let mainMesh = null, vMus = null;

// ---- dual mode: 'zone' = paint-bucket muscle highlight, 'pin' = colored pain pins ----
let mode = 'zone';

// ---- zone mode: each muscle is a body region that fills on tap (paint-bucket) ----
const STATE = {NONE:0, PAIN:1, RELIEF:2};
const muscleState = new Int8Array(MUSCLES.length);   // 0/1/2 per muscle
const muscleType = new Array(MUSCLES.length).fill(null);   // 疼痛類型 per zone（未設 = null）
const muscleScore = new Array(MUSCLES.length).fill(null);  // NRS 0-10 per zone（未設 = null）
let selectedZoneMi = null; // 目前選取的區塊（與大頭針選取互斥）
const muscleVerts = MUSCLES.map(()=>[]);             // vertex indices per muscle (set on load)
let bodyGeo = null;
const C_BASE=[0.905,0.915,0.945], C_PAIN=[0.886,0.216,0.267], C_RELIEF=[0.122,0.682,0.404];
const colorFor=(s)=> s===STATE.PAIN?C_PAIN : s===STATE.RELIEF?C_RELIEF : C_BASE;
function paintMuscle(mi){
  if(!bodyGeo) return;
  const c=bodyGeo.attributes.color, rgb=colorFor(muscleState[mi]);
  const vs=muscleVerts[mi];
  for(let k=0;k<vs.length;k++) c.setXYZ(vs[k], rgb[0],rgb[1],rgb[2]);
  c.needsUpdate=true;
}

// ---- pin mode ----
const MAX_PINS = 20;
const PAIN_TYPE_CONFIG = Object.freeze({
  defaultType:'酸痛',
  options:Object.freeze(['刺痛','酸痛','壓痛','癢','隱隱作痛','走路痛','舉手痛','轉動痛','伸直痛'])
});
const PIN_COLORS = [
  0xe6194b,0x3cb44b,0xffa500,0x4363d8,0xf032e6,0x42d4f4,0xf58231,0x911eb4,0x469990,0xdcbeff,
  0x9a6324,0x800000,0xaaffc3,0x808000,0x000075,0xff69b4,0x00a8a8,0x7fdbff,0xb10dc9,0x2ecc40
];
const pins = [];
let selectedPinId = null;

// ---- load the real anatomy model (visible body) ----
const loader = new GLTFLoader();
loader.load('assets/body.glb', (gltf)=>{
  const model = gltf.scene;
  // largest mesh = the body; others = eyes
  let maxV=0;
  model.traverse(o=>{ if(o.isMesh){ const v=o.geometry.attributes.position.count; if(v>maxV){maxV=v; mainMesh=o;} } });
  model.traverse(o=>{
    if(o.isMesh){
      o.material = (o===mainMesh)
        ? new THREE.MeshStandardMaterial({ vertexColors:true, color:0xffffff, metalness:0.0, roughness:0.78 })
        : new THREE.MeshStandardMaterial({ color:0x2b3446, roughness:0.5 });
      o.renderOrder = 1;
    }
  });
  // center + scale to ~1.78 tall, feet at y=0, front faces +Z
  const box=new THREE.Box3().setFromObject(model); const size=new THREE.Vector3(); box.getSize(size);
  model.scale.setScalar(1.78/size.y);
  model.rotation.y = 0;
  const box2=new THREE.Box3().setFromObject(model); const c2=new THREE.Vector3(),min2=box2.min; box2.getCenter(c2);
  model.position.x-=c2.x; model.position.z-=c2.z; model.position.y-=min2.y;
  scene.add(model); model.updateMatrixWorld(true);
  // assign each body vertex to its nearest muscle zone → pin labels + per-muscle fillable regions
  bodyGeo = mainMesh.geometry;
  const pos=bodyGeo.attributes.position, n=pos.count, wm=mainMesh.matrixWorld;
  const cols=new Float32Array(n*3); vMus=new Int16Array(n);
  const tv=new THREE.Vector3();
  for(let i=0;i<n;i++){
    tv.fromBufferAttribute(pos,i).applyMatrix4(wm);
    let best=0,bestD=Infinity;
    for(let mi=0;mi<MUSCLES.length;mi++){
      const M=MUSCLES[mi], dx=(tv.x-M[2])/M[5], dy=(tv.y-M[3])/M[6], dz=(tv.z-M[4])/M[7];
      const d=dx*dx+dy*dy+dz*dz; if(d<bestD){bestD=d;best=mi;}
    }
    vMus[i]=best; muscleVerts[best].push(i);
    cols[i*3]=C_BASE[0]; cols[i*3+1]=C_BASE[1]; cols[i*3+2]=C_BASE[2];
  }
  bodyGeo.setAttribute('color', new THREE.BufferAttribute(cols,3));
  window.__bodyModel = model; window.__ready = true;
}, undefined, (err)=>{ console.warn('model load failed', err); });

// ---- jarvis focus: cinematic zoom onto a zone + hologram + HUD reticle ----
const DEFAULT_TARGET = new THREE.Vector3(0, 1.02, 0);
const DEFAULT_MIN_DIST = 2.6;
const jarvisEl = document.getElementById('jarvis');
const jarvisName = document.getElementById('jarvisName');
const backBtn = document.getElementById('backFull');
let focus = null; // {mi, holo, center, radius, normal}

// hologram: fresnel rim + upward scanlines + subtle flicker (additive, over the red marks)
const holoUniforms = { uTime:{value:0} };
const holoMat = new THREE.ShaderMaterial({
  transparent:true, depthWrite:false, blending:THREE.AdditiveBlending,
  uniforms:holoUniforms,
  vertexShader:`
    varying vec3 vN; varying vec3 vW;
    void main(){
      vN = normalize(normalMatrix * normal);
      vec4 wp = modelMatrix * vec4(position + normal*0.002, 1.0);
      vW = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`,
  fragmentShader:`
    uniform float uTime; varying vec3 vN; varying vec3 vW;
    void main(){
      vec3 base = vec3(0.306, 0.788, 1.0);            // #4ec9ff
      float fres = pow(1.0 - abs(normalize(vN).z), 2.2);
      float s = fract((vW.y - uTime*0.12) * 36.0);     // upward-flowing scanlines
      float stripe = smoothstep(0.35, 0.5, s) * smoothstep(1.0, 0.8, s);
      float flick = 0.93 + 0.07*sin(uTime*31.0)*sin(uTime*17.3);
      float a = (fres*0.85 + stripe*0.22 + 0.08) * flick;
      gl_FragColor = vec4(mix(base, vec3(0.78, 0.93, 1.0), fres), a);
    }`
});

function buildHoloGeometry(mi){
  const pos = bodyGeo.attributes.position, nor = bodyGeo.attributes.normal;
  const idx = bodyGeo.index ? bodyGeo.index.array : null;
  const triCount = (idx ? idx.length : pos.count) / 3;
  const p = [], nrm = [];
  for(let t=0; t<triCount; t++){
    const a = idx?idx[t*3]:t*3, b = idx?idx[t*3+1]:t*3+1, c = idx?idx[t*3+2]:t*3+2;
    if(vMus[a]===mi || vMus[b]===mi || vMus[c]===mi){
      for(const vi of [a,b,c]){
        p.push(pos.getX(vi), pos.getY(vi), pos.getZ(vi));
        nrm.push(nor.getX(vi), nor.getY(vi), nor.getZ(vi));
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(p,3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm,3));
  return geo;
}
function zoneWorldInfo(mi){
  const pos = bodyGeo.attributes.position, nor = bodyGeo.attributes.normal;
  const wm = mainMesh.matrixWorld, nm = new THREE.Matrix3().getNormalMatrix(wm);
  const box = new THREE.Box3(), v = new THREE.Vector3(), n = new THREE.Vector3(), avgN = new THREE.Vector3();
  for(const vi of muscleVerts[mi]){
    v.fromBufferAttribute(pos,vi).applyMatrix4(wm); box.expandByPoint(v);
    n.fromBufferAttribute(nor,vi).applyMatrix3(nm); avgN.add(n);
  }
  const sphere = new THREE.Sphere(); box.getBoundingSphere(sphere);
  return {center:sphere.center.clone(), radius:Math.max(sphere.radius,0.05), normal:avgN.normalize()};
}
// camera flight: gsap power3.inOut — controls stay usable (wheel zoom) after landing
let camTweens = [];
const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)').matches;
function flyTo(pos, target, dur=0.85){
  if(REDUCED_MOTION) dur = 0;   // jump-cut instead of flight for motion-sensitive users
  camTweens.forEach(t=>t.kill());
  controls.enabled = false;
  camTweens = [
    gsap.to(camera.position, {x:pos.x, y:pos.y, z:pos.z, duration:dur, ease:'power3.inOut',
      onComplete:()=>{ controls.enabled = true; }}),
    gsap.to(controls.target, {x:target.x, y:target.y, z:target.z, duration:dur, ease:'power3.inOut'})
  ];
}
function repaintAll(){
  const c = bodyGeo.attributes.color;
  for(let i=0;i<vMus.length;i++){
    const rgb = colorFor(muscleState[vMus[i]]);
    c.setXYZ(i, rgb[0], rgb[1], rgb[2]);
  }
  c.needsUpdate = true;
}
function focusOn(mi){
  if(!bodyGeo || !mainMesh || typeof gsap === 'undefined') return;
  if(focus && focus.mi !== mi){ mainMesh.remove(focus.holo); focus.holo.geometry.dispose(); focus = null; }
  if(!focus){
    const holo = new THREE.Mesh(buildHoloGeometry(mi), holoMat);
    holo.renderOrder = 2;
    mainMesh.add(holo);
    focus = { mi, holo, ...zoneWorldInfo(mi) };
  }
  // rest of the body drops to flat grey (vertex colors — no transparency, phone-friendly)
  const c = bodyGeo.attributes.color;
  for(let i=0;i<vMus.length;i++) if(vMus[i]!==mi) c.setXYZ(i, 0.42, 0.46, 0.52);
  c.needsUpdate = true;
  paintMuscle(mi); // focused zone keeps its true pain/relief color under the hologram
  const dir = focus.normal.clone();
  dir.y = THREE.MathUtils.clamp(dir.y, -0.35, 0.55);
  if(Math.hypot(dir.x, dir.z) < 0.25) dir.z += 0.6; // top/bottom-facing zones: approach from the front
  dir.normalize();
  const dist = THREE.MathUtils.clamp(focus.radius*4.1, 0.55, 4.5);
  controls.minDistance = 0.3;
  flyTo(focus.center.clone().addScaledVector(dir, dist), focus.center, 0.85);
  const M = MUSCLES[mi];
  jarvisName.textContent = M[0] + (M[1]!=='中' ? ` · ${M[1]}` : '');
  jarvisEl.classList.add('show');
  backBtn.classList.add('show');
}
function exitFocus(fly=true){
  if(!focus) return;
  mainMesh.remove(focus.holo); focus.holo.geometry.dispose(); focus = null;
  repaintAll();
  controls.minDistance = DEFAULT_MIN_DIST;
  jarvisEl.classList.remove('show');
  backBtn.classList.remove('show');
  if(fly){
    const v = document.querySelector('#views button.on')?.dataset.v || 'front';
    const p = viewPos[v];
    flyTo(new THREE.Vector3(p[0],p[1],p[2]), DEFAULT_TARGET.clone(), 0.9);
  }
}
backBtn.onclick = ()=>exitFocus();
window.__dbg3d = { camera, controls, focusInfo:()=>focus && {mi:focus.mi, radius:focus.radius, center:focus.center.toArray()} };

// ---- interaction ----
const ray = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const tooltip = document.getElementById('tooltip');

function setPointer(e){
  const t = e.touches ? e.touches[0] : e;
  mouse.x = (t.clientX/innerWidth)*2-1;
  mouse.y = -(t.clientY/innerHeight)*2+1;
  return t;
}
function pick(){
  if(!vMus || !mainMesh) return null;
  ray.setFromCamera(mouse, camera);
  const pinHit = ray.intersectObjects(pins.map(pin=>pin.group), true)[0];
  if(pinHit) return {pinId:pinHit.object.userData.pinId};
  const hit = ray.intersectObject(mainMesh, false)[0];
  if(!hit) return null;
  const normal = hit.face.normal.clone()
    .applyMatrix3(new THREE.Matrix3().getNormalMatrix(mainMesh.matrixWorld)).normalize();
  return {muscleIndex:vMus[hit.face.a], point:hit.point.clone(), normal};
}
function createPin(hit){
  if(pins.length>=MAX_PINS){ renderList(true); return; }
  const color = PIN_COLORS.find(candidate=>!pins.some(pin=>pin.color===candidate));
  const id = ++createPin.lastId;
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({color,roughness:.4,metalness:.08});
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(.012,.012,.09,12),material);
  shaft.position.y=.045;
  const head = new THREE.Mesh(new THREE.SphereGeometry(.038,20,14),material);
  head.position.y=.105;
  for(const part of [shaft,head]){ part.userData.pinId=id; part.renderOrder=3; group.add(part); }
  group.position.copy(hit.point).addScaledVector(hit.normal,.006);
  group.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),hit.normal);
  scene.add(group);
  pins.push({id,color,group,muscleIndex:hit.muscleIndex,painType:PAIN_TYPE_CONFIG.defaultType,score:null});
  selectPin(id);
}
createPin.lastId=0;
function selectPin(id){
  selectedPinId=id;
  if(id!=null) selectedZoneMi=null;
  for(const pin of pins) pin.group.scale.setScalar(pin.id===id?1.28:1);
  renderList();
}
function selectZone(mi){
  selectedZoneMi=mi; selectedPinId=null;
  for(const pin of pins) pin.group.scale.setScalar(1);
  renderList();
}
// 目前選取的標記（大頭針優先，其次區塊）
function selectedTarget(){
  if(selectedPinId!=null){
    const pin=pins.find(candidate=>candidate.id===selectedPinId);
    if(pin) return {kind:'pin',pin};
  }
  if(selectedZoneMi!=null && muscleState[selectedZoneMi]) return {kind:'zone',mi:selectedZoneMi};
  return null;
}
addEventListener('pointermove', e=>{
  if(e.target.closest?.('.hud')){
    document.body.style.cursor='default'; tooltip.style.opacity=0; return;
  }
  const t = setPointer(e);
  const hit = pick();
  if(hit){
    document.body.style.cursor='pointer';
    if(hit.pinId){
      const pin=pins.find(candidate=>candidate.id===hit.pinId), M=MUSCLES[pin.muscleIndex];
      tooltip.textContent = `#${pin.id} ${M[0]} · ${pin.painType}${pin.score!=null?` · ${pin.score}`:''}`;
    } else {
      const M=MUSCLES[hit.muscleIndex];
      tooltip.textContent = M[0] + (M[1]!=='中'?`（${M[1]}）`:'');
    }
    tooltip.style.left = t.clientX+'px'; tooltip.style.top = t.clientY+'px'; tooltip.style.opacity=1;
  } else { document.body.style.cursor='default'; tooltip.style.opacity=0; }
});

let downXY=null;
addEventListener('pointerdown', e=>{ downXY=e.target.closest?.('.hud')?null:[e.clientX,e.clientY]; });
addEventListener('pointerup', e=>{
  if(!downXY) return;
  const moved = Math.hypot(e.clientX-downXY[0], e.clientY-downXY[1]);
  const wasTouch = e.pointerType === 'touch';
  downXY=null;
  if(moved > (wasTouch?12:6)) return; // finger wobble tolerance; a real drag = rotate, not mark
  setPointer(e);
  const hit = pick();
  if(!hit){ if(mode==='zone') exitFocus(); return; }   // tap empty space = fly back to full body
  if(hit.pinId){ selectPin(hit.pinId); return; }   // tapping a pin selects it in either mode
  if(mode==='zone'){
    const mi = hit.muscleIndex;
    muscleState[mi] = (muscleState[mi]+1)%3;  // none → pain → relief → none
    if(muscleState[mi]===STATE.NONE){
      muscleType[mi]=null; muscleScore[mi]=null;
      if(selectedZoneMi===mi) selectedZoneMi=null;
    } else {
      selectedZoneMi=mi; selectedPinId=null;
      for(const pin of pins) pin.group.scale.setScalar(1);
    }
    paintMuscle(mi);
    renderList();
    focusOn(mi);   // jarvis focus: cinematic zoom + hologram on the tapped zone
  } else {
    createPin(hit);   // pin mode: no focus flight — pinning stays undisturbed
  }
});

// ---- panel list ----
const listEl = document.getElementById('list');
const countEl = document.getElementById('count');
const editorEl = document.getElementById('editor');
const limitEl = document.getElementById('limitMessage');
const painTypesEl = document.getElementById('painTypes');
for(const type of PAIN_TYPE_CONFIG.options){
  const button=document.createElement('button');
  button.dataset.type=type; button.textContent=type;
  button.onclick=()=>{
    const target=selectedTarget(); if(!target) return;
    if(target.kind==='pin') target.pin.painType=type;
    else muscleType[target.mi]=type;
    renderList();
  };
  painTypesEl.appendChild(button);
}
// NRS 疼痛程度 0-10：一排緊湊分數鈕，再點同分 = 取消不填
const scoreRowEl = document.getElementById('scoreRow');
for(let n=0;n<=10;n++){
  const button=document.createElement('button');
  button.dataset.score=n; button.textContent=n;
  button.onclick=()=>{
    const target=selectedTarget(); if(!target) return;
    if(target.kind==='pin') target.pin.score = target.pin.score===n?null:n;
    else muscleScore[target.mi] = muscleScore[target.mi]===n?null:n;
    renderList();
  };
  scoreRowEl.appendChild(button);
}
const EMPTY_TEXT = {
  zone:'點選身體任一部位標記疼痛。<br>再點一下 = 已緩解，第三下 = 清除。',
  pin:'點擊身體插入大頭針。<br>選取大頭針後設定疼痛類型。'
};
function renderList(showLimit=false){
  const zones=[]; for(let mi=0;mi<MUSCLES.length;mi++) if(muscleState[mi]) zones.push(mi);
  countEl.textContent = `${zones.length + pins.length}`;
  limitEl.style.display = showLimit||(mode==='pin'&&pins.length>=MAX_PINS)?'block':'none';
  listEl.innerHTML = '';
  if(!zones.length && !pins.length) listEl.innerHTML = `<div id="empty">${EMPTY_TEXT[mode]}</div>`;
  const target=selectedTarget();
  for(const mi of zones){
    const M=MUSCLES[mi], s=muscleState[mi], side=M[1];
    const row=document.createElement('div'); row.className='row zone';
    if(target?.kind==='zone' && target.mi===mi) row.classList.add('selected');
    const parts=[];
    if(side!=='中') parts.push(side);
    parts.push(s===STATE.PAIN ? (muscleType[mi]||'疼痛') : '已緩解');
    if(muscleScore[mi]!=null) parts.push(muscleScore[mi]);
    row.innerHTML = `<span class="swatch" style="background:${s===STATE.PAIN?'#e23744':'#1fae67'}"></span>
      <span class="nm">${M[0]}</span>
      <span class="side">${parts.join(' · ')}</span>`;
    row.onclick=()=>selectZone(mi);
    listEl.appendChild(row);
  }
  for(const pin of pins){
    const M=MUSCLES[pin.muscleIndex], side=M[1];
    const row=document.createElement('div'); row.className='row';
    if(pin.id===selectedPinId) row.classList.add('selected');
    const parts=[];
    if(side!=='中') parts.push(side);
    parts.push(pin.painType);
    if(pin.score!=null) parts.push(pin.score);
    row.innerHTML = `<span class="swatch" style="background:#${pin.color.toString(16).padStart(6,'0')}"></span>
      <span class="nm">#${pin.id} ${M[0]}</span><span class="side">${parts.join(' · ')}</span>`;
    row.onclick=()=>selectPin(pin.id);
    listEl.appendChild(row);
  }
  editorEl.classList.toggle('visible',!!target);
  if(target){
    let title, curType, curScore;
    if(target.kind==='pin'){
      const M=MUSCLES[target.pin.muscleIndex];
      title=`目前選取：#${target.pin.id} ${M[0]}`;
      curType=target.pin.painType; curScore=target.pin.score;
    } else {
      const M=MUSCLES[target.mi];
      title=`目前選取：${M[0]}${M[1]!=='中'?`（${M[1]}）`:''}`;
      curType=muscleType[target.mi]; curScore=muscleScore[target.mi];
    }
    document.getElementById('editorTitle').textContent=title;
    document.querySelectorAll('#painTypes button').forEach(button=>
      button.classList.toggle('on',button.dataset.type===curType));
    scoreRowEl.querySelectorAll('button').forEach(button=>
      button.classList.toggle('on',Number(button.dataset.score)===curScore));
    document.getElementById('deletePin').style.display = target.kind==='pin'?'block':'none';
  }
}
document.getElementById('deletePin').onclick=()=>{
  const index=pins.findIndex(pin=>pin.id===selectedPinId); if(index<0) return;
  scene.remove(pins[index].group); pins.splice(index,1);
  selectedPinId=pins.at(-1)?.id??null; selectPin(selectedPinId);
};
document.getElementById('clear').onclick = ()=>{
  exitFocus();
  for(let mi=0;mi<MUSCLES.length;mi++){ if(muscleState[mi]){ muscleState[mi]=STATE.NONE; paintMuscle(mi); } }
  muscleType.fill(null); muscleScore.fill(null);
  for(const pin of pins) scene.remove(pin.group);
  pins.length=0; selectedPinId=null; selectedZoneMi=null;
  renderList();
};

// ---- mode switch: 區塊標記（原亮肌肉互動）↔ 大頭針標記；切換不清除另一模式的標記 ----
const modeButtons = { zone:document.getElementById('modeZone'), pin:document.getElementById('modePin') };
const legendEl = document.getElementById('zoneLegend');
const hintEl = document.getElementById('hint');
const HINT_TEXT = {
  zone:'拖曳 <b>旋轉</b> · 點擊部位 <b>標記並聚焦</b> · 點空白 <b>返回全身</b>',
  pin:'拖曳 <b>旋轉</b> · 滾輪 <b>縮放</b> · 點擊身體 <b>插入大頭針</b>'
};
function setMode(next){
  if(next==='pin') exitFocus();
  mode = next;
  modeButtons.zone.classList.toggle('on', mode==='zone');
  modeButtons.pin.classList.toggle('on', mode==='pin');
  legendEl.style.display = mode==='zone'?'flex':'none';
  hintEl.innerHTML = HINT_TEXT[mode];
  renderList();
}
modeButtons.zone.onclick = ()=>setMode('zone');
modeButtons.pin.onclick = ()=>setMode('pin');
setMode('zone');

// collapsible panel — keeps the body clear of the sheet, esp. on phones
const panelEl = document.getElementById('panel');
document.getElementById('panelHead').addEventListener('click', ()=> panelEl.classList.toggle('collapsed'));
if(innerWidth <= 640) panelEl.classList.add('collapsed'); // start collapsed on mobile

// ---- view buttons ----
const viewPos = {
  front:[0,1.15,5.4], back:[0,1.15,-5.4], left:[5.4,1.15,0], right:[-5.4,1.15,0]
};
document.querySelectorAll('#views button').forEach(b=>{
  b.onclick = ()=>{
    document.querySelectorAll('#views button').forEach(x=>x.classList.remove('on'));
    b.classList.add('on');
    controls.autoRotate=false;
    exitFocus(false);
    const p = viewPos[b.dataset.v];
    flyTo(new THREE.Vector3(p[0],p[1],p[2]), DEFAULT_TARGET.clone());
  };
});

// ---- resize ----
addEventListener('resize', ()=>{
  camera.aspect = innerWidth/innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---- loop ----
const clock = new THREE.Clock();
const projV = new THREE.Vector3();
function tick(){
  requestAnimationFrame(tick);
  const dt = clock.getDelta();
  ring.rotation.z += dt*0.4; ring2.rotation.z -= dt*0.25;
  holoUniforms.uTime.value = clock.elapsedTime;
  if(focus){
    // 3D→2D projection: pin the jarvis reticle onto the focused zone every frame
    projV.copy(focus.center).project(camera);
    if(projV.z < 1){
      const x = (projV.x*0.5+0.5)*innerWidth, y = (-projV.y*0.5+0.5)*innerHeight;
      jarvisEl.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    }
  }
  controls.update();
  renderer.render(scene, camera);
}
tick();
renderList();
