// Keep the launch window and the browser address alive across application restarts.
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import lockfile from "proper-lockfile";
import { activeRelease, holdRelease, pruneReleases, updateDir, recordActive } from "./studio-update.mjs";

export async function runStudio(root, active, head) {
  const base = updateDir(root);
  if (active.id) holdRelease(active.directory);
  const buildId = await readFile(path.join(root, "dist/client/studio-version.json"), "utf8")
    .then(JSON.parse).then(m => m.revision).catch(() => "");
  let installed = active.id || buildId || head || "";
  let state = { phase: "idle", message: "", version: installed };
  let child, port, switching = false, busy = false;

  function status(phase, message) {
    state = { phase, message, version: installed };
    if (child?.connected) child.send({ type: "status", state }, () => {});
  }
  function launch(directory, initial = false) {
    const worker = fork(path.join(directory, "server/serve.mjs"), initial ? process.argv.slice(2) : [], {
      cwd: root, env: { ...process.env, STUDIO_INSTALL_ROOT: root, ...(port && { PORT: String(port), STUDIO_EXACT_PORT: "1" }) },
    });
    child = worker;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { worker.kill(); reject(Error("新服务启动超时")); }, 60000);
      worker.on("message", msg => {
        if (msg.type === "ready") {
          clearTimeout(timer);
          port = msg.port;
          worker.send({ type: "status", state });
          resolve();
        } else if (msg.type === "apply" && worker === child && !busy) {
          void update();
        }
      });
      worker.once("error", e => { clearTimeout(timer); reject(e); });
      worker.once("exit", (code, signal) => {
        clearTimeout(timer);
        reject(Error("工作室启动失败"));
        if (!switching && child === worker) process.exitCode = code ?? (signal ? 1 : 0);
      });
    });
  }
  async function stopWorker(drain) {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const worker = child;
    if (!drain || !worker.connected) {
      const stopped = once(worker, "exit");
      worker.kill();
      await stopped;
      return;
    }
    await new Promise((resolve, reject) => {
      function exited() { worker.off("message", message); resolve(); }
      function message(msg) {
        if (msg.type !== "drainError") return;
        worker.off("exit", exited);
        worker.off("message", message);
        reject(Error("无法读取任务状态，请检查本地任务记录后重试。"));
      }
      worker.once("exit", exited);
      worker.on("message", message);
      worker.send({ type: "drain" });
    });
  }
  async function update() {
    busy = true;
    let unlock, plan;
    const old = active;
    status("working", "正在检查主分支…");
    try {
      await mkdir(base, { recursive: true });
      unlock = await lockfile.lock(base, { realpath: false, retries: 0, stale: 120000 })
        .catch(() => { throw Error("另一个工作室正在更新，请稍后重试。"); });
      const priorSelection = await activeRelease(root);
      const updater = await import(pathToFileURL(path.join(active.directory, "server/studio-update.mjs")).href);
      plan = await updater.prepareUpdate(root, installed, msg => status("working", msg));
      if (!plan) { status("current", "已是主分支最新版本"); return; }
      switching = true;
      status("working", "正在等待当前任务完成并重启…");
      await stopWorker(true);
      status("restarting", "正在启动新版本…");
      try {
        await launch(plan.directory);
        await recordActive(root, plan.id);
        await updater.advanceCheckout(root, plan);
      } catch (e) {
        await stopWorker(false);
        await recordActive(root, priorSelection.id);
        await launch(old.directory);
        throw e;
      }
      installed = plan.id;
      active = plan;
      status("updated", "更新完成");
      await pruneReleases(root, [installed, old.id]).catch(() => {});
    } catch (e) {
      console.error("更新失败", e.message);
      status("error", e.message);
    } finally {
      switching = false;
      busy = false;
      if (unlock) await unlock();
    }
  }
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
    if (child?.exitCode === null) child.kill(signal);
    process.exit(0);
  });
  await launch(active.directory, true).catch(e => {
    // A duplicate launcher opens the running workspace then exits successfully.
    if (child?.exitCode !== 0) { console.error(e.message); process.exitCode = 1; }
  });
}
