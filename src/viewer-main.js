// stl viewer frontend — port of monster_shelf's StlViewer.tsx for sushi.
// Bundled with esbuild (see tools/build-bundle.sh) into a single classic
// script so it loads from file:// inside WebKit (ES modules are blocked
// from file:// by CORS). Do not edit the bundle by hand; edit this file.
import * as THREE from '../vendor/three.module.js';
import { STLLoader } from '../vendor/STLLoader.js';
import { OrbitControls } from '../vendor/OrbitControls.js';

// Monster shelf palette: bark background, warm key + gold rim, gray pla.
const BG = 0x1c1109;
const MATERIAL = { color: 0xb8b2a6, metalness: 0.15, roughness: 0.55 };

let renderer = null;
let scene = null;
let camera = null;
let controls = null;
let mesh = null;

function el(id) {
  return document.getElementById(id);
}

function showStatus(text) {
  const overlay = el('stl-status');
  overlay.style.display = 'flex';
  el('stl-status-text').textContent = text;
}

function hideStatus() {
  el('stl-status').style.display = 'none';
}

function showError(text) {
  hideStatus();
  const overlay = el('stl-error');
  overlay.style.display = 'flex';
  el('stl-error-text').textContent = text;
}

function signalReady() {
  try {
    window.webkit.messageHandlers.stlReady.postMessage('ready');
  } catch (e) {
    // GJS side falls back to polling document.title.
    document.title = '__stl_ready__';
  }
}

function fitCamera(radius) {
  const dist = (radius / Math.sin((camera.fov * Math.PI) / 360)) * 1.15;
  camera.position.set(dist * 0.55, dist * 0.4, dist * 0.75);
  controls.target.set(0, 0, 0);
  controls.minDistance = radius * 0.6;
  controls.maxDistance = radius * 6;
  controls.update();
}

function initScene() {
  const mount = el('stl-mount');
  scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);

  camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10000);
  camera.position.set(60, 40, 80);

  renderer = null;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
  } catch (e) {
    showError('WebGL is unavailable: ' + (e && e.message ? e.message : e));
    throw e;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  mount.appendChild(renderer.domElement);

  const hemi = new THREE.HemisphereLight(0xfff4e0, 0x3a2a18, 1.4);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(3, 6, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xc9a227, 0.8);
  rim.position.set(-4, 3, -5);
  scene.add(rim);

  // Drag to rotate, scroll to zoom. No pan (matches monster shelf).
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;

  const resize = () => {
    const w = mount.clientWidth || 400;
    const h = mount.clientHeight || 400;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  };
  resize();
  new ResizeObserver(resize).observe(mount);
  window.addEventListener('resize', resize);

  const animate = () => {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  };
  animate();
}

// Called by the sushi wrapper with the whole file as base64.
// Gio reads the file (works for local and smb:// alike); this keeps the
// WebView on its locked-down sandboxed context with no file access.
window.__stlLoad = function (b64, name) {
  el('stl-name').textContent = name || '';
  showStatus('Loading model…');
  // Let the overlay paint before the (possibly slow) parse.
  setTimeout(() => {
    try {
      const raw = atob(b64);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);

      const geometry = new STLLoader().parse(bytes.buffer);
      geometry.computeVertexNormals();
      geometry.center();
      geometry.computeBoundingSphere();
      const radius = (geometry.boundingSphere && geometry.boundingSphere.radius) || 50;

      const material = new THREE.MeshStandardMaterial(MATERIAL);
      mesh = new THREE.Mesh(geometry, material);
      scene.add(mesh);
      fitCamera(radius);

      hideStatus();
      signalReady();
    } catch (e) {
      showError('Failed to load model: ' + (e && e.message ? e.message : e));
    }
  }, 30);
};

// Called by the sushi wrapper to display a fatal error (e.g. file too
// large) inside the page. Rendered in-page — not via sushi's 'error'
// signal — because sushi only surfaces renderer errors when the window is
// already visible, leaving fresh opens stuck invisible.
window.__stlError = function (text) {
  showError(text);
};

initScene();
