/* 開発用の静的サーバー(依存なし)。Range要求(<video>/<audio>用)と正しいMIMEに対応。
   使い方: node tools/serve.mjs [port]   → http://localhost:8765/ */
import { createServer } from 'node:http';
import { stat, readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const PORT = Number(process.argv[2]) || 8765;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.m4a': 'audio/mp4', '.mp4': 'video/mp4', '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(ROOT, path));
    if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    const st = await stat(file).catch(() => null);
    if (!st || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found'); return; }
    const type = MIME[extname(file)] || 'application/octet-stream';
    const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' };
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    if (range) {
      let start = range[1] ? Number(range[1]) : 0;
      let end = range[2] ? Number(range[2]) : st.size - 1;
      if (!range[1] && range[2]) { start = Math.max(0, st.size - Number(range[2])); end = st.size - 1; }
      end = Math.min(end, st.size - 1);
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
      createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { ...headers, 'Content-Length': st.size });
    if (req.method === 'HEAD') { res.end(); return; }
    createReadStream(file).pipe(res);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' }); res.end(String(err));
  }
}).listen(PORT, '127.0.0.1', () => console.log(`http://localhost:${PORT}/  (root: ${ROOT})`));
