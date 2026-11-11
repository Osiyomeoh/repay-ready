// Local server: public/ plus the same Web handlers Vercel runs from api/.
// Usage: npm run dev   (http://localhost:3000)
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

type Handler = (req: Request) => Response | Promise<Response>;
const routes: Record<string, Record<string, unknown>> = {
  "/api/position": await import("../api/position.js"),
  "/api/plan": await import("../api/plan.js"),
  "/api/check": await import("../api/check.js"),
  "/api/sample": await import("../api/sample.js"),
};
const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
};
const port = Number(process.env.PORT ?? 3000);

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  const mod = routes[url.pathname];
  if (mod) {
    const fn = mod[req.method ?? "GET"] as Handler | undefined;
    if (typeof fn !== "function") return void res.writeHead(405).end();
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const wreq = new Request(url, { method: req.method, headers: req.headers as HeadersInit, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
    const wres = await fn(wreq);
    res.writeHead(wres.status, Object.fromEntries(wres.headers));
    return void res.end(Buffer.from(await wres.arrayBuffer()));
  }
  const file = normalize(join("public", url.pathname === "/" ? "index.html" : url.pathname));
  if (!file.startsWith("public")) return void res.writeHead(403).end();
  try {
    const data = await readFile(file);
    res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" }).end(data);
  } catch {
    res.writeHead(404).end("Not found");
  }
}).listen(port, () => console.log(`Repay Ready on http://localhost:${port}`));
