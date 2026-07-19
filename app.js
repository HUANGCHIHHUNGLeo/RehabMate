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
const MAX_PINS = 20;
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
        ? new THREE.MeshStandardMaterial({ color:0xe8eaf1, metalness:0.0, roughness:0.78 })
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
  // assign each body vertex to its nearest muscle zone for pin labels
  const pos=mainMesh.geometry.attributes.position, n=pos.count, wm=mainMesh.matrixWorld;
  vMus=new Int16Array(n);
  const tv=new THREE.Vector3();
  for(let i=0;i<n;i++){
    tv.fromBufferAttribute(pos,i).applyMatrix4(wm);
    let best=0,bestD=Infinity;
    for(let mi=0;mi<MUSCLES.length;mi++){
      const M=MUSCLES[mi], dx=(tv.x-M[2])/M[5], dy=(tv.y-M[3])/M[6], dz=(tv.z-M[4])/M[7];
      const d=dx*dx+dy*dy+dz*dz; if(d<bestD){bestD=d;best=mi;}
    }
    vMus[i]=best;
  }
  window.__bodyModel = model; window.__ready = true;
}, undefined, (err)=>{ console.warn('model load failed', err); });

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
  pins.push({id,color,group,muscleIndex:hit.muscleIndex,painType:'酸痛'});
  selectPin(id);
}
createPin.lastId=0;
function selectPin(id){
  selectedPinId=id;
  for(const pin of pins) pin.group.scale.setScalar(pin.id===id?1.28:1);
  renderList();
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
      tooltip.textContent = `#${pin.id} ${M[0]} · ${pin.painType}`;
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
  if(!hit) return;
  if(hit.pinId) selectPin(hit.pinId); else createPin(hit);
});

// ---- panel list ----
const listEl = document.getElementById('list');
const countEl = document.getElementById('count');
const editorEl = document.getElementById('editor');
const limitEl = document.getElementById('limitMessage');
function renderList(showLimit=false){
  countEl.textContent = `${pins.length} / ${MAX_PINS}`;
  limitEl.style.display = showLimit||pins.length>=MAX_PINS?'block':'none';
  listEl.innerHTML = '';
  if(!pins.length) listEl.innerHTML = '<div id="empty">點擊身體插入大頭針。<br>選取大頭針後設定疼痛類型。</div>';
  for(const pin of pins){
    const M=MUSCLES[pin.muscleIndex], side=M[1];
    const row=document.createElement('div'); row.className='row';
    if(pin.id===selectedPinId) row.classList.add('selected');
    row.innerHTML = `<span class="swatch" style="background:#${pin.color.toString(16).padStart(6,'0')}"></span>
      <span class="nm">#${pin.id} ${M[0]}</span><span class="side">${side!=='中'?side+' · ':''}${pin.painType}</span>`;
    row.onclick=()=>selectPin(pin.id);
    listEl.appendChild(row);
  }
  const selected=pins.find(pin=>pin.id===selectedPinId);
  editorEl.classList.toggle('visible',!!selected);
  if(selected){
    const M=MUSCLES[selected.muscleIndex];
    document.getElementById('editorTitle').textContent=`目前選取：#${selected.id} ${M[0]}`;
    document.querySelectorAll('#painTypes button').forEach(button=>
      button.classList.toggle('on',button.dataset.type===selected.painType));
  }
}
document.querySelectorAll('#painTypes button').forEach(button=>button.onclick=()=>{
  const pin=pins.find(candidate=>candidate.id===selectedPinId); if(!pin) return;
  pin.painType=button.dataset.type; renderList();
});
document.getElementById('deletePin').onclick=()=>{
  const index=pins.findIndex(pin=>pin.id===selectedPinId); if(index<0) return;
  scene.remove(pins[index].group); pins.splice(index,1);
  selectedPinId=pins.at(-1)?.id??null; selectPin(selectedPinId);
};
document.getElementById('clear').onclick = ()=>{
  for(const pin of pins) scene.remove(pin.group);
  pins.length=0; selectedPinId=null;
  renderList();
};

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
    const p = viewPos[b.dataset.v];
    animateCam(new THREE.Vector3(p[0],p[1],p[2]));
  };
});
let camAnim=null;
function animateCam(to){ camAnim={from:camera.position.clone(), to, t:0}; }

// ---- resize ----
addEventListener('resize', ()=>{
  camera.aspect = innerWidth/innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---- loop ----
const clock = new THREE.Clock();
function tick(){
  requestAnimationFrame(tick);
  const dt = clock.getDelta();
  ring.rotation.z += dt*0.4; ring2.rotation.z -= dt*0.25;
  if(camAnim){
    camAnim.t = Math.min(1, camAnim.t + dt*1.8);
    const e = 1-Math.pow(1-camAnim.t,3);
    camera.position.lerpVectors(camAnim.from, camAnim.to, e);
    if(camAnim.t>=1) camAnim=null;
  }
  controls.update();
  renderer.render(scene, camera);
}
tick();
renderList();
