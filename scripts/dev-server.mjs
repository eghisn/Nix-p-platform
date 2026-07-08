import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";

const rootArg = process.argv[2] || ".";
const root = resolve(process.cwd(), rootArg);
const port = Number(process.env.PORT || 4173);

const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2"
};

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const clean = normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  return resolve(join(root, clean));
}

async function sendFile(res, filePath) {
  const fileStat = await stat(filePath);
  res.writeHead(200, {
    "content-length": fileStat.size,
    "content-type": types[extname(filePath)] || "application/octet-stream"
  });
  createReadStream(filePath).pipe(res);
}

createServer(async (req, res) => {
  try {
    const requested = safePath(req.url || "/");
    if (!requested.startsWith(root)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    if (existsSync(requested) && (await stat(requested)).isFile()) {
      await sendFile(res, requested);
      return;
    }

    const indexPath = join(root, "index.html");
    const html = await readFile(indexPath, "utf8");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  } catch (error) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end(error instanceof Error ? error.message : "Server error");
  }
}).listen(port, () => {
  console.log(`NIXP local prototype running at http://localhost:${port}`);
});
