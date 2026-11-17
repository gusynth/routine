const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
let original = 0,
  compressed = 0,
  count = 0;
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (/\.(js|css|svg)$/.test(entry.name)) {
      const input = fs.readFileSync(file);
      const br = zlib.brotliCompressSync(input, {
        params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 },
      });
      fs.writeFileSync(file + ".br", br);
      fs.writeFileSync(file + ".gz", zlib.gzipSync(input, { level: 9 }));
      original += input.length;
      compressed += br.length;
      count++;
    }
  }
}
walk(path.resolve(__dirname, "../public"));
console.log(
  `Static assets: ${count} files, ${original} -> ${compressed} bytes with Brotli.`,
);
