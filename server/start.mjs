import express from "express";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { realpath } from "node:fs/promises";
import { studioApi } from "./api.mjs";
import { root } from "./storage.mjs";

const app = studioApi(),
  files = path.join(root, "dist/client");
const workspace = createHash("sha256")
  .update(await realpath(root))
  .digest("hex");
app.get("/_studio/instance", (_req, res) =>
  res.set("Cache-Control", "no-store").json({ workspace }),
);
app.use(express.static(files));
app.get("/{*all}", (_req, res) => res.sendFile(path.join(files, "index.html")));

function listen(port) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, "127.0.0.1");
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
    if (e.code !== "EADDRINUSE") throw e;
    const active = await fetch(
      "http://127.0.0.1:" + port + "/_studio/instance",
      { signal: AbortSignal.timeout(800) },
    )
      .then((r) => r.json())
      .catch(() => null);
    if (active?.workspace === workspace) break;
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
