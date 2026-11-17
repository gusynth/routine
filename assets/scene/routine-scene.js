import * as THREE from "three";
import { MeshTransmissionMaterial } from "@pmndrs/vanilla/materials/MeshTransmissionMaterial.js";
import { dampE, damp3 } from "maath/easing";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import {
  advanceGlassDistortion,
  shaderResolution,
  scenePointer,
  sceneSourceSize,
  settledResize,
  sceneQuality,
} from "./scene-dynamics.mjs";

// Public reference inspected 2026-11-15:
// https://www.raycast.com/
// https://www.raycast.com/_next/static/immutable/chunks/0g9me6ox1p3e7.js
// The approved background is unchanged. A separate foreground scene holds
// the Routine mark; its lighting and materials cannot affect the background.
const root = document.getElementById("routine-raycast-glass-final");
const stage = root.querySelector(".rr-scene"),
  canvas = root.querySelector("canvas");
const status = root.querySelector(".rr-status"),
  play = root.querySelector(".rr-play");
const options = new URLSearchParams(location.search);
const isBanner = options.get("view") === "workout";
const reference = JSON.parse(root.querySelector(".rr-reference").textContent);
if (isBanner) {
  root.classList.add("rr-workout");
  stage.setAttribute(
    "aria-label",
    "Barras de vidro diagonais com cores em movimento. O mouse conduz suavemente as cores.",
  );
  const palettes = [
    [
      { r: 205, g: 249, b: 255 },
      { r: 48, g: 214, b: 255 },
      { r: 0, g: 95, b: 160 },
    ],
    [
      { r: 244, g: 222, b: 255 },
      { r: 202, g: 118, b: 255 },
      { r: 100, g: 18, b: 210 },
    ],
    [
      { r: 255, g: 254, b: 244 },
      { r: 255, g: 187, b: 74 },
      { r: 180, g: 67, b: 2 },
    ],
  ];
  const palette = palettes[Number(options.get("palette"))] || palettes[0];
  if (palette)
    [
      reference.cubeShader.color1,
      reference.cubeShader.color2,
      reference.cubeShader.color3,
    ] = palette;
}
const g = reference.glass,
  c = reference.cylinder,
  s = reference.scene;
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const constrained =
  matchMedia("(pointer: coarse)").matches || (navigator.deviceMemory || 8) <= 4;
// Desktop preserves the approved optics. Touch screens use a bounded mobile
// profile; normalized colors and elapsed animation time remain identical.
const profile = sceneQuality({
  coarse: matchMedia("(pointer: coarse)").matches,
  width: screen.width,
  height: screen.height,
  deviceDpr: devicePixelRatio,
});
const opticalReferenceResolution = g.resolution;
if (profile.mobile) g.resolution = profile.resolution;
let maxDpr = profile.dpr,
  slowWindows = 0,
  mobileDowngraded = false;
let targetFps = 30;
let hasDrawn = false;
let renderWidth = 0,
  renderHeight = 0;
let paused =
  reduced || new URLSearchParams(location.search).get("motion") === "off";
let renderer;
try {
  renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    preserveDrawingBuffer: false,
    powerPreference: "default",
  });
} catch (error) {
  window.RoutineSceneGuard?.fail("R-GFX-001");
  throw error;
}
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.setPixelRatio(1);
renderer.debug.onShaderError = () =>
  window.RoutineSceneGuard?.fail("R-GFX-005");

const scene = new THREE.Scene();
scene.background = new THREE.Color(
  s.backgroundColor.r / 255,
  s.backgroundColor.g / 255,
  s.backgroundColor.b / 255,
);
const camera = new THREE.PerspectiveCamera(35, 1200 / 895, 0.01, 100);
camera.position.set(0, 0, s.cameraZ);
const buffer = new THREE.WebGLRenderTarget(g.resolution, g.resolution, {
  type: THREE.HalfFloatType,
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
  depthBuffer: true,
});
const linearColor = (value) =>
  new THREE.Color(value.r / 255, value.g / 255, value.b / 255);
const uniforms = {
  uTime: { value: 0 },
  uSpeed: { value: reference.cubeShader.speed },
  uSize: { value: reference.cubeShader.size },
  uColor1: { value: linearColor(reference.cubeShader.color1) },
  uColor2: { value: linearColor(reference.cubeShader.color2) },
  uColor3: { value: linearColor(reference.cubeShader.color3) },
  uResolution: { value: new THREE.Vector2(1200, 895) },
};
const shaderViewport = new THREE.Vector2();
function drawScene(subject, target = null) {
  const size = target || renderer.getDrawingBufferSize(shaderViewport);
  const resolution = shaderResolution(
    size.width ?? size.x,
    size.height ?? size.y,
    opticalReferenceResolution,
  );
  uniforms.uResolution.value.set(resolution.x, resolution.y);
  renderer.setRenderTarget(target);
  renderer.render(subject, camera);
}
const sourceMaterial = new THREE.ShaderMaterial({
  uniforms,
  side: THREE.DoubleSide,
  vertexShader:
    "void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
  fragmentShader: `
 uniform float uTime,uSpeed,uSize;
 uniform vec3 uColor1,uColor2,uColor3;
 uniform vec2 uResolution;
 void main(){
  float t=uTime*uSpeed+10000.;
  vec2 xy=(gl_FragCoord.xy/uResolution-.5)*uSize+.5;
  float horizontal=cos(3.*xy.x+t);
  float diagonal=cos(xy.x*cos(t)+5.*xy.y*sin(t)+t);
  vec2 p=.3*xy-.5+vec2(cos(t),sin(t*.5));
  float radial=sin(20.*sqrt(dot(p,p)+1.)+t);
  float value=(horizontal+diagonal+radial)/3.;
  float normalized=(value+1.)*.5;
  vec3 color=normalized<.5?mix(uColor3,uColor2,normalized*2.):mix(uColor2,uColor1,(normalized-.5)*2.);
  gl_FragColor=vec4(pow(color,vec3(3.)),1.);
 }`,
});
const sourceGeometry = new THREE.BoxGeometry(...sceneSourceSize(isBanner));
const cube = new THREE.Mesh(sourceGeometry, sourceMaterial);
cube.position.set(0, s.cubeY, s.cubeZ);
cube.scale.setScalar(1);
scene.add(cube);
const cylinders = new THREE.CylinderGeometry(
  c.radius,
  c.radius,
  c.height,
  c.subdivisions,
  1,
);
const group = new THREE.Group();
group.position.z = s.glassZ;
group.rotation.z = s.glassRotation;
scene.add(group);
let material,
  instances,
  currentSamples = 0;
const viewportHeight =
  2 * s.cameraZ * Math.tan(THREE.MathUtils.degToRad(35) / 2);
function buildGlass(samples) {
  if (samples === currentSamples) return;
  if (instances) {
    group.remove(instances);
    instances.dispose();
    material.dispose();
  }
  currentSamples = samples;
  material = new MeshTransmissionMaterial({
    samples,
    transmission: 0,
    _transmission: g.transmission,
    thickness: g.thickness,
    roughness: g.roughness,
    anisotropicBlur: g.anisotropicBlur,
    chromaticAberration: g.chromaticAberration,
    distortion: g.distortion,
    distortionScale: g.distortionScale,
    temporalDistortion: g.temporalDistortion,
    buffer: buffer.texture,
  });
  material.ior = g.ior;
  material.specularIntensity = 0;
  material.dithering = false;
  instances = new THREE.InstancedMesh(cylinders, material, c.count);
  instances.frustumCulled = false;
  const diameter = c.radius * 2;
  for (let index = 0; index < c.count; index++)
    instances.setMatrixAt(
      index,
      new THREE.Matrix4().makeTranslation(
        (index + diameter) * diameter - (diameter * c.count) / 2,
        0,
        0,
      ),
    );
  instances.instanceMatrix.needsUpdate = true;
  group.add(instances);
}

function createLogoLayer() {
  // Capture exactly the approved background, then refract it through the logo.
  // The capture has the same pixel dimensions and linear output as the canvas.
  const logoBuffer = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.UnsignedByteType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: true,
    samples: Math.min(profile.msaa, renderer.capabilities.maxSamples),
  });
  const foreground = new THREE.Scene();
  const screenGeometry = new THREE.PlaneGeometry(2, 2);
  const screenMaterial = new THREE.ShaderMaterial({
    uniforms: { image: { value: logoBuffer.texture } },
    vertexShader:
      "varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,1.,1.);}",
    fragmentShader:
      "uniform sampler2D image;varying vec2 vUv;void main(){gl_FragColor=texture2D(image,vUv);}",
    depthWrite: false,
    depthTest: false,
  });
  const screen = new THREE.Mesh(screenGeometry, screenMaterial);
  screen.frustumCulled = false;
  screen.renderOrder = -10;
  foreground.add(screen);

  // Extrude the official SVG rather than approximating its silhouette.
  const svg = root
    .querySelector(".rr-brand svg")
    .outerHTML.replace('fill="currentColor"', 'fill="#ffffff"');
  const paths = new SVGLoader().parse(svg).paths;
  const shapes = paths.flatMap((path) => SVGLoader.createShapes(path));
  const logoGeometry = new THREE.ExtrudeGeometry(shapes, {
    depth: 34,
    bevelEnabled: true,
    bevelSegments: 4,
    bevelSize: 2.4,
    bevelThickness: 3.5,
    curveSegments: 32,
    steps: 1,
    material: 0,
    extrudeMaterial: 1,
  });
  // A rotation preserves triangle winding while converting SVG's downward Y.
  logoGeometry.rotateX(Math.PI);
  logoGeometry.computeBoundingBox();
  const logoSpan = logoGeometry.boundingBox.getSize(new THREE.Vector3()).x;
  logoGeometry.center();
  logoGeometry.scale(1 / logoSpan, 1 / logoSpan, 1 / logoSpan);
  const logoFace = new MeshTransmissionMaterial({
    samples: profile.mobile ? profile.faceSamples : constrained ? 8 : 10,
    transmission: 0,
    _transmission: 1,
    roughness: 0.17,
    thickness: 34 / logoSpan,
    anisotropicBlur: 0.2,
    chromaticAberration: 0.04,
    buffer: logoBuffer.texture,
  });
  logoFace.ior = 1.48;
  logoFace.specularIntensity = 0.78;
  logoFace.envMapIntensity = 0.72;
  logoFace.attenuationColor = new THREE.Color().setRGB(0.93, 0.96, 1);
  logoFace.attenuationDistance = 2.5;
  logoFace.clearcoat = 0.15;
  logoFace.clearcoatRoughness = 0.12;
  logoFace.dithering = false;
  const logoEdge = new MeshTransmissionMaterial({
    samples: profile.edgeSamples,
    transmission: 0,
    _transmission: 1,
    roughness: 0.045,
    thickness: 40 / logoSpan,
    anisotropicBlur: 0.075,
    chromaticAberration: 0.06,
    buffer: logoBuffer.texture,
  });
  logoEdge.ior = 1.5;
  logoEdge.specularIntensity = 1;
  logoEdge.envMapIntensity = 0.95;
  logoEdge.clearcoat = 0.18;
  logoEdge.clearcoatRoughness = 0.065;
  logoEdge.dithering = false;
  const logo = new THREE.Mesh(logoGeometry, [logoFace, logoEdge]);
  logo.position.set(0, 0, 2.2);
  foreground.add(logo);

  // Neutral reflections belong only to the logo. No lights enter the Raycast scene.
  const studio = new THREE.Scene();
  studio.background = new THREE.Color(0, 0, 0);
  const panelGeometry = new THREE.PlaneGeometry(1, 1),
    panelMaterials = [];
  for (const [position, scale, power] of [
    [[-4, 3, 5], [2.5, 7], 1.7],
    [[4, 1, 3], [0.7, 6], 2.0],
    [[0, 0, 7], [7, 5], 0.45],
    [[-1, -4, 4], [4.5, 0.6], 0.4],
  ]) {
    const panelMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(power, power, power),
      side: THREE.DoubleSide,
    });
    panelMaterials.push(panelMaterial);
    const panel = new THREE.Mesh(panelGeometry, panelMaterial);
    panel.position.set(...position);
    panel.scale.set(scale[0], scale[1], 1);
    panel.lookAt(0, 0, 0);
    studio.add(panel);
  }
  const pmrem = new THREE.PMREMGenerator(renderer),
    environment = pmrem.fromScene(studio, 0.04, 0.1, 50);
  logoFace.envMap = logoEdge.envMap = environment.texture;
  pmrem.dispose();
  panelGeometry.dispose();
  panelMaterials.forEach((value) => value.dispose());
  return {
    render() {
      drawScene(scene, logoBuffer);
      drawScene(foreground);
    },
    setTime(time) {
      logoFace.time = logoEdge.time = time;
    },
    resize() {
      const drawingSize = renderer.getDrawingBufferSize(new THREE.Vector2());
      logoBuffer.setSize(drawingSize.x, drawingSize.y);
      const logoViewHeight =
        2 *
        (s.cameraZ - logo.position.z) *
        Math.tan(THREE.MathUtils.degToRad(35) / 2);
      logo.scale.setScalar(logoViewHeight * camera.aspect * 0.45);
    },
    dispose() {
      for (const resource of [
        logoBuffer,
        screenGeometry,
        screenMaterial,
        logoGeometry,
        logoFace,
        logoEdge,
        environment,
      ])
        resource.dispose();
    },
  };
}
const logoLayer = isBanner ? null : createLogoLayer();

let raf = 0,
  last = 0,
  elapsed = 0,
  visible = true,
  hostActive = window.parent === window,
  hostAcknowledged = window.parent === window,
  disposed = false,
  worldWidth = 14,
  quality = profile.mobile ? profile.dpr / 2 : 1;
let fpsFrames = 0,
  fpsElapsed = 0;
const mouse = new THREE.Vector2(0, 0);
function render() {
  group.visible = false;
  drawScene(scene, buffer);
  group.visible = true;
  if (logoLayer) logoLayer.render();
  else drawScene(scene);
}
function frame(now) {
  try {
    drawFrame(now);
  } catch {
    disposed = true;
    window.RoutineSceneGuard?.fail("R-GFX-003");
  }
}
function drawFrame(now) {
  raf = 0;
  if (disposed || !visible || document.hidden || (!hostActive && hasDrawn))
    return;
  if (last && !paused && now - last < 1000 / targetFps - 0.5) {
    raf = requestAnimationFrame(frame);
    return;
  }
  const wallDelta = last ? Math.max(0, (now - last) / 1000) : 1 / targetFps;
  const delta = Math.min(0.05, wallDelta);
  last = now;
  if (!paused && hostActive) {
    // Shader time follows elapsed seconds even on a slow GPU; only physics
    // damping uses the capped delta. Otherwise low fps looks almost frozen.
    elapsed += wallDelta;
    uniforms.uTime.value = elapsed;
    material.time = elapsed;
    logoLayer?.setTime(elapsed);
    damp3(cube.scale, [1, 1, 1], 1, delta);
    dampE(
      cube.rotation,
      [
        mouse.x * reference.cubeInteraction.rotationInfluence,
        -mouse.y * reference.cubeInteraction.rotationInfluence,
        cube.rotation.z,
      ],
      0.5,
      delta,
    );
    if (worldWidth > 7.3 && g.animateDistortion) {
      advanceGlassDistortion(material.uniforms, delta);
    }
  }
  render();
  hasDrawn = true;
  window.RoutineSceneGuard?.ready();
  if (!paused && hostActive) {
    fpsFrames++;
    fpsElapsed += wallDelta;
    if (fpsElapsed > 3 && s.monitorPerf) {
      const fps = fpsFrames / fpsElapsed;
      window.parent.postMessage(
        {
          type: "routine:scene-metrics",
          fps: Math.round(fps),
          width: canvas.width,
          height: canvas.height,
          quality,
        },
        location.origin,
      );
      if (fps < targetFps * 0.65 && targetFps > 20) {
        targetFps = Math.max(20, targetFps - 5);
        window.parent.postMessage(
          { type: "routine:scene-error", code: "R-PERF-001" },
          location.origin,
        );
      }
      if (profile.mobile && !mobileDowngraded) {
        slowWindows = fps < 18 ? slowWindows + 1 : 0;
        if (slowWindows >= 2 && maxDpr > 1.25) {
          mobileDowngraded = true;
          maxDpr = 1.25;
          quality = maxDpr / 2;
          resize(false, true);
          window.parent.postMessage(
            { type: "routine:scene-error", code: "R-PERF-002" },
            location.origin,
          );
        }
      }
      fpsFrames = 0;
      fpsElapsed = 0;
    }
    raf = requestAnimationFrame(frame);
  }
}
function wake() {
  if (
    !disposed &&
    !raf &&
    visible &&
    (hostActive || !hasDrawn) &&
    !document.hidden
  ) {
    last = 0;
    raf = requestAnimationFrame(frame);
  }
}
function resize(schedule = true, force = false) {
  const width = stage.clientWidth,
    height = stage.clientHeight;
  if (!width || !height) return;
  if (!force && width === renderWidth && height === renderHeight) return;
  if (hasDrawn && (!visible || document.hidden)) return;
  const wasRendered = hasDrawn;
  renderWidth = width;
  renderHeight = height;
  const logicalWidth = 1200,
    logicalHeight = 895;
  camera.aspect = logicalWidth / logicalHeight;
  if (isBanner) {
    // Crop the approved scene vertically instead of stretching its glass geometry.
    const cropHeight = (logicalWidth * height) / width;
    camera.setViewOffset(
      logicalWidth,
      logicalHeight,
      0,
      (logicalHeight - cropHeight) / 2,
      logicalWidth,
      cropHeight,
    );
  }
  camera.updateProjectionMatrix();
  uniforms.uResolution.value.set(logicalWidth, logicalHeight);
  worldWidth = viewportHeight * camera.aspect;
  buildGlass(
    profile.mobile
      ? profile.glassSamples
      : constrained
        ? g.mobileSamples
        : g.samples,
  );
  renderer.setPixelRatio(maxDpr);
  renderer.setSize(width, height, false);
  logoLayer?.resize();
  // Clear and redraw in the same task. Never reveal the startup poster
  // during an ordinary layout change, including a paused/suspended scene.
  if (wasRendered) {
    render();
    window.RoutineSceneGuard?.ready();
  }
  if (schedule) wake();
}
function onPointer(event) {
  const bounds = stage.getBoundingClientRect();
  const pointer = scenePointer(
    event.clientX - bounds.left,
    event.clientY - bounds.top,
    bounds.width,
    bounds.height,
    camera.view,
  );
  mouse.set(pointer.x, pointer.y);
}
function resetPointer() {
  mouse.set(0, 0);
}
stage.addEventListener("pointermove", onPointer, { passive: true });
stage.addEventListener("pointerdown", onPointer, { passive: true });
stage.addEventListener("pointerleave", resetPointer, { passive: true });
function syncControls() {
  play.textContent = paused ? "Ativar animação" : "Pausar animação";
  play.setAttribute("aria-pressed", String(paused));
}
play.onclick = () => {
  paused = !paused;
  syncControls();
  requestHostState();
  wake();
  publishState();
};
const resizeQueue = settledResize(() => {
  if (disposed) return;
  try {
    resize();
  } catch {
    disposed = true;
    window.RoutineSceneGuard?.fail("R-GFX-003");
  }
});
const resizeObserver = new ResizeObserver(() => resizeQueue.schedule());
resizeObserver.observe(stage);
// Embedded scenes follow the page's viewport policy. A second cross-frame
// IntersectionObserver can disagree during WebView2 startup and strand a RAF.
const visibilityObserver =
  window.parent === window
    ? new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
        if (visible) {
          resizeQueue.schedule();
          wake();
        } else if (raf) {
          cancelAnimationFrame(raf);
          raf = 0;
        }
      })
    : null;
visibilityObserver?.observe(stage);
function onVisibility() {
  if (document.hidden) {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  } else {
    resizeQueue.schedule();
    requestHostState();
    wake();
  }
  publishState();
}
function requestHostState() {
  if (window.parent !== window)
    window.parent.postMessage({ type: "routine:scene-ready" }, location.origin);
}
function publishState() {
  window.parent.postMessage(
    {
      type: "routine:scene-state",
      paused,
      hostActive,
      running: !!raf,
      failed: disposed,
      elapsed,
    },
    location.origin,
  );
}
window.RoutineSceneState = () => ({
  profile: profile.mobile ? "mobile-balanced" : "desktop",
  dpr: maxDpr,
  transmissionResolution: g.resolution,
  paused,
  hostActive,
  running: !!raf,
  failed: disposed,
  elapsed,
  hasDrawn,
});
function onHostVisibility(event) {
  if (
    event.source !== window.parent ||
    event.origin !== location.origin ||
    event.data?.type !== "routine:scene-visibility"
  )
    return;
  hostAcknowledged = true;
  root.classList.toggle("rr-compact", event.data.compact === true);
  hostActive = event.data.active === true;
  if (hostActive || !hasDrawn) wake();
  else {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }
  publishState();
}
window.addEventListener("message", onHostVisibility);
document.addEventListener("visibilitychange", onVisibility);
window.addEventListener(
  "routine:scene-failed",
  () => {
    disposed = true;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    renderer.dispose();
  },
  { once: true },
);

resize();
syncControls();
requestHostState();
// Retry the handshake until acknowledged; loading/compilation can consume the
// initial message. Also restart a dropped eligible loop without reloading GL.
const lifecycleTimer = setInterval(() => {
  if (disposed) return;
  if (!hostAcknowledged) requestHostState();
  if (!paused && hostActive && visible && !document.hidden && !raf) {
    wake();
    window.parent.postMessage(
      { type: "routine:scene-error", code: "R-GFX-007" },
      location.origin,
    );
  }
  publishState();
}, 1500);
window.addEventListener("pageshow", requestHostState);
window.addEventListener("focus", requestHostState);

window.addEventListener(
  "pagehide",
  () => {
    disposed = true;
    if (raf) cancelAnimationFrame(raf);
    resizeObserver.disconnect();
    resizeQueue.cancel();
    visibilityObserver?.disconnect();
    clearInterval(lifecycleTimer);
    window.removeEventListener("pageshow", requestHostState);
    window.removeEventListener("focus", requestHostState);
    stage.removeEventListener("pointermove", onPointer);
    stage.removeEventListener("pointerdown", onPointer);
    stage.removeEventListener("pointerleave", resetPointer);
    document.removeEventListener("visibilitychange", onVisibility);
    instances.dispose();
    cylinders.dispose();
    sourceGeometry.dispose();
    material.dispose();
    sourceMaterial.dispose();
    buffer.dispose();
    logoLayer?.dispose();
    window.removeEventListener("message", onHostVisibility);
    renderer.dispose();
    renderer.forceContextLoss();
  },
  { once: true },
);
