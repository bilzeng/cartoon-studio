import express from "express";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { access, realpath } from "node:fs/promises";
import { studioApi } from "./api.mjs";
import { root, jobs } from "./storage.mjs";
import { builtVersion, holdRelease } from "./studio-update.mjs";

const app = express(),
  files = path.join(root, "dist/client");
const build = await builtVersion(root);
const version = process.env.STUDIO_RUNNING_REVISION || build.revision || build.frontend || "";
const workspace = createHash("sha256")
  .update(await realpath(process.env.STUDIO_INSTALL_ROOT || root))
  .digest("hex");
await access(path.join(files, "index.html"));
if (process.env.STUDIO_INSTALL_ROOT && path.resolve(root) !== path.resolve(process.env.STUDIO_INSTALL_ROOT)) holdRelease(root);
let state = { phase: "starting", message: "正在启动工作室…", version: "" };
let server, draining = false, pending = 0;
app.use((req, res, next) => {
  if (req.method === "POST" && /^\/api\/projects\/[^/]+\/(generate|export)\/?$/.test(req.path)) {
    if (draining || (process.env.STUDIO_EXACT_PORT && ["starting", "restarting"].includes(state.phase))) return res.status(503).json({ error: "工作室即将重启，请更新完成后再提交任务。" });
    pending++;
    res.once("close", () => pending--);
  }
  next();
});
app.use(studioApi());
app.get("/_studio/update", (_req, res) => res.set("Cache-Control", "no-store").json(state));
app.post("/_studio/update", (req, res) => {
  if (req.headers.origin !== "http://" + req.headers.host || !req.is("application/json"))
    return res.sendStatus(403);
  if (state.phase === "starting") return res.status(503).json({ error: "工作室正在启动" });
  if (!["working", "restarting"].includes(state.phase)) {
    state = { ...state, phase: "working", message: "正在检查主分支…" };
    process.send({ type: "apply" });
  }
  res.status(202).json(state);
});
process.on("message", async msg => {
  if (msg.type === "status") state = msg.state;
  if (msg.type !== "drain" || draining) return;
  draining = true;
  try {
    while (pending || (await jobs()).some(j => ["running", "queued", "waiting"].includes(j.status)))
      await new Promise(r => setTimeout(r, 750));
    server.close(() => process.exit(0));
  } catch {
    draining = false;
    process.send({ type: "drainError" });
  }
});
process.on("disconnect", () => process.exit(0));
app.get("/_studio/instance", (_req, res) =>
  res.set("Cache-Control", "no-store").json({ workspace, version, updater: true }),
);
app.use(express.static(files, {
  index: false,
  setHeaders(res, file) {
    if (file === path.join(files, "index.html")) res.setHeader("Cache-Control", "no-store");
  },
}));
app.get("/{*all}", (_req, res) => res.set("Cache-Control", "no-store").sendFile("index.html", { root: files }));

function listen(port) {
  return new Promise((resolve, reject) => {
    server = app.listen(port, "127.0.0.1");
    server.once("error", reject);
    server.once("listening", () => resolve(server.address().port));
  });
}
let port = Number(process.env.PORT ?? 4317);
for (let attempts = 0; ; attempts++) {
  try {
    port = await listen(port);
    break;
  } catch (e) {
    if (process.env.STUDIO_EXACT_PORT || e.code !== "EADDRINUSE") throw e;
    const active = await fetch(
      "http://127.0.0.1:" + port + "/_studio/instance",
      { signal: AbortSignal.timeout(800) },
    )
      .then((r) => r.json())
      .catch(() => null);
    // An older launcher can still own the default port after a manual upgrade.
    if (active?.workspace === workspace && active.updater === true && active.version === version) {
      server = null;
      break;
    }
    port = attempts < 8 && port < 65535 ? port + 1 : 0;
  }
}
const url = "http://127.0.0.1:" + port + "/";
console.log("镜场 · 个人画布助手  " + url);
if (process.argv.includes("--open") && !process.env.STUDIO_NO_OPEN) {
  const [cmd, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["rundll32.exe", ["url.dll,FileProtocolHandler", url]]
        : ["xdg-open", [url]];
  const browser = spawn(cmd, args, { stdio: "ignore", detached: true });
  browser.on("error", () => console.log("请在浏览器打开上方地址。"));
  browser.unref();
}

if (server) process.send({ type: "ready", port });
else process.disconnect();
