const { test } = require("node:test");
const assert = require("node:assert/strict");
const dynamics = import("../assets/scene/scene-dynamics.mjs");
const THREE = require("three");

test("sidebar resize bursts preserve the live frame and only allocate at the settled width", async () => {
  const { settledResize } = await dynamics;
  const timers = new Map();
  let id = 0,
    width = 500;
  const allocations = [];
  const clock = {
    clearTimeout(id) {
      timers.delete(id);
    },
    setTimeout(fn) {
      timers.set(++id, fn);
      return id;
    },
  };
  const queue = settledResize(() => allocations.push(width), 140, clock);
  for (width = 500; width < 900; width += 10) queue.schedule();
  assert.equal(allocations.length, 0);
  assert.equal(timers.size, 1);
  [...timers.values()][0]();
  timers.clear();
  assert.deepEqual(allocations, [900]);
  queue.schedule();
  queue.cancel();
  assert.equal(timers.size, 0);
});

test("workout emitter caps stay outside the lower and upper crop throughout pointer movement", async () => {
  const { sceneSourceSize } = await dynamics;
  assert.deepEqual(sceneSourceSize(false), [7, 7, 7]);
  function visibleCaps(size) {
    let worst = -Infinity;
    for (const aspect of [20 / 7, 2.6]) {
      const height = 1200 / aspect;
      const camera = new THREE.PerspectiveCamera(35, 1200 / 895, 0.01, 100);
      camera.position.z = 16.54;
      camera.setViewOffset(1200, 895, 0, (895 - height) / 2, 1200, height);
      camera.updateMatrixWorld();
      for (let pitch = -0.3; pitch <= 0.301; pitch += 0.03)
        for (let yaw = -0.3; yaw <= 0.301; yaw += 0.03) {
          const matrix = new THREE.Matrix4().compose(
            new THREE.Vector3(0, 0, -9),
            new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0)),
            new THREE.Vector3(1, 1, 1),
          );
          for (const x of [-size[0] / 2, size[0] / 2])
            for (const z of [-size[2] / 2, size[2] / 2])
              for (const side of [-1, 1]) {
                const point = new THREE.Vector3(x, (side * size[1]) / 2, z)
                  .applyMatrix4(matrix)
                  .project(camera);
                // Both cap corners must remain beyond NDC [-1, 1], not just
                // the object's bounding box (which can hide a tilted cap).
                worst = Math.max(worst, -side * point.y);
              }
        }
    }
    return worst;
  }
  assert.ok(
    visibleCaps([7, 7, 7]) > -1,
    "Reproduces the cap entering the original banner crop",
  );
  assert.ok(
    visibleCaps(sceneSourceSize(true)) < -1.1,
    "Caps remain outside the crop with a safety margin on desktop and mobile",
  );
});

test("glass refraction stays bounded and consistent across refresh rates", async () => {
  const { advanceGlassDistortion } = await dynamics;
  const snapshots = [];
  for (const fps of [30, 60, 120, 144]) {
    const uniforms = {
      distortion: { value: 0 },
      temporalDistortion: { value: 0 },
    };
    for (let frame = 0; frame < fps * 90; frame++) {
      advanceGlassDistortion(uniforms, 1 / fps);
      assert.ok(
        uniforms.distortion.value >= 0 && uniforms.distortion.value <= 0.08,
      );
      assert.ok(
        uniforms.temporalDistortion.value >= 0 &&
          uniforms.temporalDistortion.value <= 0.025,
      );
      if (frame === fps * 10 - 1) snapshots.push(uniforms.distortion.value);
    }
    assert.equal(uniforms.distortion.value, 0.08);
  }
  assert.ok(
    Math.max(...snapshots) - Math.min(...snapshots) < 0.0001,
    "The visual must not become more deformed on a faster display",
  );
});

test("adaptive resolution and logo capture retain the same shader color coordinates", async () => {
  const { shaderResolution } = await dynamics;
  const reference = shaderResolution(1024, 1024, 1024);
  assert.deepEqual(reference, { x: 1200, y: 895 });
  // Identical normalized screen positions in source buffers, cropped banners,
  // and high-DPI logo captures must sample the identical procedural color.
  for (const [width, height] of [
    [1024, 1024],
    [832, 832],
    [640, 640],
    [256, 256],
    [1200, 895],
    [1672, 585],
    [720, 536],
  ]) {
    const resolution = shaderResolution(width, height, 1024);
    for (const [x, y] of [
      [0.1, 0.2],
      [0.5, 0.5],
      [0.9, 0.7],
    ]) {
      assert.ok(
        Math.abs((x * width) / resolution.x - (x * 1024) / reference.x) < 1e-12,
      );
      assert.ok(
        Math.abs((y * height) / resolution.y - (y * 1024) / reference.y) <
          1e-12,
      );
    }
  }
});

test("pointer coordinates respect the horizontal crop without exaggerated vertical movement", async () => {
  const { scenePointer } = await dynamics;
  assert.deepEqual(scenePointer(600, 447.5, 1200, 895), { x: 0, y: 0 });
  const crop = { enabled: true, offsetY: 237.5, height: 420, fullHeight: 895 };
  assert.deepEqual(scenePointer(600, 210, 1200, 420, crop), { x: 0, y: 0 });
  assert.ok(
    Math.abs(scenePointer(600, 0, 1200, 420, crop).y - 420 / 895) < 1e-12,
  );
  assert.ok(
    Math.abs(scenePointer(600, 420, 1200, 420, crop).y + 420 / 895) < 1e-12,
  );
  assert.deepEqual(scenePointer(-10, 1000, 1200, 895), { x: -1, y: -1 });
});

test("mobile quality lowers GPU buffers without changing desktop or relying on card width", async () => {
  const { sceneQuality } = await dynamics;
  const desktop = sceneQuality({
    coarse: false,
    width: 1920,
    height: 1080,
    deviceDpr: 1,
  });
  assert.equal(desktop.dpr, 2);
  assert.equal(desktop.resolution, 1024);
  assert.equal(desktop.faceSamples, 10);
  const phone = sceneQuality({
    coarse: true,
    width: 390,
    height: 844,
    deviceDpr: 3,
  });
  assert.equal(phone.mobile, true);
  assert.equal(phone.dpr, 1.5);
  assert.equal(phone.resolution, 512);
  assert.ok(phone.faceSamples < desktop.faceSamples);
  assert.equal(phone.msaa, 2);
  assert.equal(
    sceneQuality({ coarse: true, width: 844, height: 390, deviceDpr: 3 }).dpr,
    phone.dpr,
  );
  assert.equal(
    sceneQuality({ coarse: false, width: 390, height: 844 }).mobile,
    false,
  );
});
