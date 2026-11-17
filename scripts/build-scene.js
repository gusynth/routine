const esbuild = require("esbuild");
const fs = require("node:fs");
const path = require("node:path");

esbuild.buildSync({
  entryPoints: ["assets/scene/routine-scene.js"],
  bundle: true,
  minify: true,
  format: "iife",
  platform: "browser",
  target: ["es2020"],
  outfile: "public/scene/scene.bundle.js",
  legalComments: "linked",
});

fs.mkdirSync("public/scene/licenses", { recursive: true });
for (const [source, name] of [
  ["node_modules/three/LICENSE", "three.txt"],
  ["assets/scene/maath.LICENSE", "maath.txt"],
  ["node_modules/@pmndrs/vanilla/LICENSE", "pmndrs-vanilla.txt"],
]) {
  fs.copyFileSync(source, path.join("public/scene/licenses", name));
}
