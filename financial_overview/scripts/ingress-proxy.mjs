// Front door for the add-on: the Home Assistant ingress iframe and direct LAN
// access both arrive here, and the Next server runs on a port nothing outside
// the container can reach.
//
// Two jobs:
//   1. Rewrite the marker base path to the prefix the browser is actually on.
//      See scripts/ingress-path.mjs for why the prefix cannot be baked in.
//   2. Forward the client's Host header. Next compares Origin against Host for
//      every Server Action, and the browser's Origin is Home Assistant, so
//      letting the proxy's own hostname through would make every form fail with
//      "Invalid Server Actions request".
import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";
import {
  resolvePrefix,
  rewriteLocation,
  rewriteSetCookie,
  rewriteUrls,
  upstreamPath,
} from "./ingress-path.mjs";

const PORT = Number(process.env.PORT ?? 3000);
const APP_PORT = Number(process.env.APP_PORT ?? 3001);
const APP_HOST = "127.0.0.1";

// Hop-by-hop headers must not be forwarded (RFC 9110). `accept-encoding` goes too:
// the responses are rewritten, which needs the plain bytes.
const DROP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "accept-encoding",
]);

const TEXTUAL = /^(?:text\/|application\/(?:javascript|json|x-component))/i;

function handle(req, res) {
  const prefix = resolvePrefix(req.headers, req.url);

  const headers = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (!DROP.has(name)) headers[name] = value;
  }
  const host = req.headers.host ?? `${APP_HOST}:${APP_PORT}`;
  headers.host = host;
  headers["x-forwarded-host"] = host;
  headers["accept-encoding"] = "identity";

  const upstream = http.request(
    {
      host: APP_HOST,
      port: APP_PORT,
      method: req.method,
      path: upstreamPath(prefix, req.url),
      headers,
    },
    (fromApp) => {
      const chunks = [];
      fromApp.on("data", (chunk) => chunks.push(chunk));
      fromApp.on("error", () => res.destroy());
      fromApp.on("end", () => {
        let body = Buffer.concat(chunks);
        const out = { ...fromApp.headers };
        delete out["content-encoding"];
        delete out["content-length"];
        // A rewritten body has a different length, so its ETag is wrong too.
        delete out.etag;

        if (TEXTUAL.test(String(fromApp.headers["content-type"] ?? "")) && body.length > 0) {
          body = Buffer.from(rewriteUrls(body.toString("utf8"), prefix), "utf8");
        }
        // Redirects have to move with the app: a bare "/login" from Next would
        // send the ingress iframe to the Home Assistant homepage. `refresh` is
        // Next's fallback for clients that ignore `location`.
        if (out.location) out.location = rewriteLocation(String(out.location), prefix);
        if (out.refresh) out.refresh = rewriteUrls(String(out.refresh), prefix);
        if (out["set-cookie"]) {
          out["set-cookie"] = []
            .concat(out["set-cookie"])
            .map((cookie) => rewriteSetCookie(String(cookie), prefix));
        }

        out["content-length"] = String(body.length);
        res.writeHead(fromApp.statusCode ?? 502, out);
        res.end(body);
      });
    },
  );

  upstream.on("error", () => {
    if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
    res.end("The app is not answering yet.\n");
  });

  req.pipe(upstream);
}

/** Resolve once the Next server accepts connections, so the first page load works. */
async function waitForApp(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const open = await new Promise((resolve) => {
      const socket = net.connect(APP_PORT, APP_HOST);
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
    });
    if (open) return;
    if (Date.now() > deadline) throw new Error(`app did not start on ${APP_HOST}:${APP_PORT}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

const app = spawn(
  process.execPath,
  ["./node_modules/next/dist/bin/next", "start", "--hostname", APP_HOST, "--port", String(APP_PORT)],
  { stdio: "inherit" },
);

// One process to supervise: if the app dies, the container should restart, not
// keep serving 502s.
app.on("exit", (code) => process.exit(code ?? 1));
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    app.kill(signal);
  });
}

await waitForApp();

const server = http.createServer(handle);
server.listen(PORT, "0.0.0.0", () => {
  console.log(`[ingress-proxy] listening on 0.0.0.0:${PORT}, app on ${APP_HOST}:${APP_PORT}`);
});
