const fs = require("node:fs/promises");
const path = require("node:path");

// Optional build-time compression. Edited files always fall back to the live
// source, so running development servers never serve an older compressed copy.
function compressedAssets(directory) {
  return async (req, res, next) => {
    if (
      !["GET", "HEAD"].includes(req.method) ||
      !/^\/[\w./-]+\.(js|css|svg)$/.test(req.path) ||
      req.path.split("/").some((part) => part.startsWith("."))
    )
      return next();
    const encoding = req.acceptsEncodings("br", "gzip", "identity");
    if (!["br", "gzip"].includes(encoding)) return next();
    const source = path.join(directory, req.path.slice(1));
    const packed = source + (encoding === "br" ? ".br" : ".gz");
    try {
      const [original, compressed] = await Promise.all([
        fs.stat(source),
        fs.stat(packed),
      ]);
      if (compressed.mtimeMs < original.mtimeMs) return next();
      res.type(path.extname(source));
      res.set("Content-Encoding", encoding);
      res.vary("Accept-Encoding");
      res.sendFile(packed, { cacheControl: true, maxAge: 0 }, (error) => {
        if (error) next(error);
      });
    } catch (error) {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") return next();
      next(error);
    }
  };
}
module.exports = { compressedAssets };
