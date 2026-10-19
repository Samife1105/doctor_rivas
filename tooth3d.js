import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const host = document.getElementById('tooth3d');
if (host) init();

function init() {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch { return; } // sin WebGL se queda el diente SVG de respaldo
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  host.appendChild(renderer.domElement);
  host.classList.add('ready');

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  camera.position.set(0, 0.2, 8.4);

  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(3, 5, 4);
  scene.add(key, new THREE.AmbientLight(0xffffff, 0.35));

  const pivot = new THREE.Group();
  scene.add(pivot);
  pivot.add(buildMolar());
  pivot.rotation.set(0.32, 0.5, 0);

  // Si existe un modelo real en assets/tooth.glb, se usa en lugar del procedural.
  fetch('assets/tooth.glb', { method: 'HEAD' }).then(r => {
    if (!r.ok) return;
    new GLTFLoader().load('assets/tooth.glb', g => {
      pivot.clear();
      const box = new THREE.Box3().setFromObject(g.scene);
      const size = box.getSize(new THREE.Vector3()).length();
      g.scene.scale.setScalar(4.2 / size);
      box.setFromObject(g.scene);
      g.scene.position.sub(box.getCenter(new THREE.Vector3()));
      pivot.add(g.scene);
    });
  }).catch(() => {});

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableZoom = false;
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.autoRotate = !reduce;
  controls.autoRotateSpeed = 2.2;
  controls.target.set(0, -0.1, 0);
  renderer.domElement.style.touchAction = 'pan-y'; // en móvil el scroll vertical sigue funcionando
  let resume;
  controls.addEventListener('start', () => { controls.autoRotate = false; clearTimeout(resume); host.classList.add('touched'); });
  controls.addEventListener('end', () => { if (!reduce) resume = setTimeout(() => (controls.autoRotate = true), 2500); });

  function resize() {
    const w = host.clientWidth, h = host.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(host);
  resize();

  let visible = true;
  new IntersectionObserver(([e]) => (visible = e.isIntersecting)).observe(host);
  const t0 = performance.now();
  renderer.setAnimationLoop(() => {
    if (!visible) return;
    if (!reduce && controls.autoRotate) pivot.position.y = Math.sin((performance.now() - t0) / 1100) * 0.07;
    controls.update();
    renderer.render(scene, camera);
  });
}

/* Molar procedural: corona con cúspides y fosa central + dos raíces. */
function buildMolar() {
  const g = new THREE.Group();

  const enamel = new THREE.MeshPhysicalMaterial({
    color: 0xf7f4ec, roughness: 0.22, metalness: 0,
    clearcoat: 1, clearcoatRoughness: 0.12,
    sheen: 0.6, sheenColor: new THREE.Color(0xfff6e0), sheenRoughness: 0.5,
    envMapIntensity: 1.1
  });
  const dentin = new THREE.MeshPhysicalMaterial({
    color: 0xe6d5b2, roughness: 0.55, clearcoat: 0.25, clearcoatRoughness: 0.5, envMapIntensity: 0.8
  });

  const neckMat = new THREE.MeshPhysicalMaterial({ color: 0xeee3c8, roughness: 0.4, clearcoat: 0.4, envMapIntensity: 0.9 });

  // Corona
  const crown = new THREE.SphereGeometry(1, 128, 96);
  const p = crown.attributes.position;
  const v = new THREE.Vector3();
  const sq = (a, b) => 1 / Math.pow(Math.pow(Math.abs(a), 4) + Math.pow(Math.abs(b), 4), 0.25 );
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    let { x, y, z } = v;
    const r = Math.hypot(x, z);
    if (r > 1e-5) {
      // cuadrar la sección (superelipse) y achatar en profundidad
      const k = 1 + (sq(x / r, z / r) - 1) * 0.55;
      x *= k * 0.9; z *= k * 0.8;
    }
    if (y >= 0) {
      const xn = x / 0.95, zn = z / 0.85;
      const f = ((1 - Math.cos(2 * Math.PI * xn)) * (1 - Math.cos(2 * Math.PI * zn))) / 4;
      const top = Math.pow(y, 1.4);
      y = y * 0.85 + 0.2 * f * top;
      y -= 0.06 * (1 - Math.min(1, r * 1.6)) * top; // fosa central
    } else {
      const t = -y;
      const taper = 1 - 0.42 * Math.pow(t, 1.1); // estrechamiento hacia el cuello
      x *= taper; z *= taper;
      y = y * 0.8;
    }
    p.setXYZ(i, x, y, z);
  }
  crown.computeVertexNormals();
  const crownMesh = new THREE.Mesh(crown, enamel);
  crownMesh.position.y = 0.62;
  g.add(crownMesh);

  // Raíces
  const root = (sx, bend, len, rad) => {
    const geo = new THREE.CylinderGeometry(rad, rad * 0.16, len, 48, 28, false);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const t = 1 - (v.y / len + 0.5); // 0 arriba -> 1 punta
      v.x += sx * bend * t * t;
      v.z += Math.sin(t * 3.1) * 0.05;
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, dentin);
    m.position.set(sx * 0.3, 0.2 - len / 2, 0);
    return m;
  };
  g.add(root(-1, 0.2, 1.8, 0.3));
  g.add(root(1, 0.2, 1.8, 0.3));

  // Cuello (zona de encía) que une corona y raíces
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.5, 0.5, 48), neckMat);
  neck.scale.z = 0.85;
  neck.position.y = 0.06;
  g.add(neck);

  g.position.y = -0.1;
  g.scale.setScalar(1.25);
  return g;
}
