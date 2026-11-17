// Damping uses time-based exponential decay, never an ease-in curve: an ease-in
// here accumulates refraction once per frame instead of once per second.
export function advanceGlassDistortion(uniforms, delta) {
  const step = Math.min(0.05, Math.max(0, delta));
  const response = 1 - Math.exp(-step / 3);
  for (const [uniform, target] of [
    [uniforms.distortion, 0.08],
    [uniforms.temporalDistortion, 0.025],
  ]) {
    const next = uniform.value + (target - uniform.value) * response;
    uniform.value = Math.abs(next - target) < 0.000001 ? target : next;
  }
}

// Preserve the approved 1024px reference while keeping normalized shader
// coordinates identical in the source buffer, glass capture and canvas.
export function shaderResolution(width, height, referenceResolution) {
  return {
    x: (width * 1200) / referenceResolution,
    y: (height * 895) / referenceResolution,
  };
}

export function scenePointer(x, y, width, height, view) {
  const normalizedX = x / Math.max(1, width);
  let normalizedY = y / Math.max(1, height);
  if (view?.enabled)
    normalizedY = (view.offsetY + normalizedY * view.height) / view.fullHeight;
  return {
    x: Math.max(-1, Math.min(1, normalizedX * 2 - 1)),
    y: Math.max(-1, Math.min(1, 1 - normalizedY * 2)),
  };
}

// A banner crops the full scene. Keep the rotating emitter's top/bottom caps
// outside that crop, including the full pointer rotation and refraction margin.
export function sceneSourceSize(isBanner) {
  return [7, isBanner ? 16 : 7, 7];
}

// Reallocate framebuffers once after a layout transition, not on every
// intermediate width. CSS keeps displaying/scaling the current live canvas.
export function settledResize(callback, delay = 140, clock = globalThis) {
  let timer;
  return {
    schedule() {
      clock.clearTimeout(timer);
      timer = clock.setTimeout(() => {
        timer = undefined;
        callback();
      }, delay);
    },
    cancel() {
      clock.clearTimeout(timer);
      timer = undefined;
    },
  };
}
// Screen/input based, never iframe width: narrow desktop cards keep full quality.
export function sceneQuality({ coarse, width, height, deviceDpr = 2 }) {
  const mobile = coarse && Math.min(width, height) <= 1024;
  return mobile
    ? {
        mobile,
        dpr: Math.min(1.5, deviceDpr || 1),
        resolution: 512,
        glassSamples: 4,
        faceSamples: 5,
        edgeSamples: 3,
        msaa: 2,
      }
    : {
        mobile,
        dpr: 2,
        resolution: 1024,
        glassSamples: 6,
        faceSamples: 10,
        edgeSamples: 6,
        msaa: 4,
      };
}
