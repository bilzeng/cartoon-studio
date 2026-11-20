import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { access, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const repository = "bilzeng/cartoon-studio";
const revision = /^[a-f0-9]{40}$/;
export const updateDir = root => path.join(root, ".studio", "updates");

// Other ports can still be serving an older revision from the same installation.
export function holdRelease(directory) {
  const marker = path.join(directory, ".studio-use-" + process.pid);
  writeFileSync(marker, "");
  process.once("exit", () => { try { unlinkSync(marker); } catch {} });
}
export async function pruneReleases(root, keep) {
  const base = updateDir(root);
  for (const name of await readdir(base)) {
    if (!revision.test(name) || keep.includes(name)) continue;
    const directory = path.join(base, name);
    const inUse = (await readdir(directory)).some(file => {
      const pid = /^\.studio-use-(\d+)$/.exec(file);
      if (!pid) return false;
      try { process.kill(Number(pid[1]), 0); return true; } catch (e) { return e.code !== "ESRCH"; }
    });
    if (!inUse) await rm(directory, { recursive: true, force: true });
  }
}

async function command(cmd, args, cwd, timeout = 120000, env = {}) {
  return (await exec(cmd, args, { cwd, windowsHide: true, timeout, maxBuffer: 8 << 20,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...env } })).stdout.trim();
}
const git = (root, ...args) => command("git", args, root);
export async function checkoutVersion(root) {
  if (!existsSync(path.join(root, ".git"))) return null;
  return git(root, "rev-parse", "HEAD");
}
export async function activeRelease(root) {
  try {
    const id = (await readFile(path.join(updateDir(root), "active"), "utf8")).trim();
    if (!revision.test(id)) throw Error("更新版本记录无效");
    const directory = path.join(updateDir(root), id);
    await access(path.join(directory, "server", "serve.mjs"));
    return { id, directory };
  } catch (e) {
    if (e.code === "ENOENT") return { id: "", directory: root };
    throw e;
  }
}
export async function recordActive(root, id) {
  const file = path.join(updateDir(root), "active");
  if (!id) return rm(file, { force: true });
  if (!revision.test(id)) throw Error("更新版本无效");
  await writeFile(file + ".tmp", id);
  await rename(file + ".tmp", file);
}
async function branchSource(root) {
  const branch = await git(root, "symbolic-ref", "--quiet", "--short", "HEAD").catch(() => "");
  const config = key => git(root, "config", "--get", "branch." + branch + "." + key).catch(() => "");
  const remote = await config("remote") || "origin";
  const tracked = await config("merge");
  if (!branch || (tracked ? tracked !== "refs/heads/main" : branch !== "main") || remote === "." || remote.startsWith("-"))
    throw Error("当前分支未跟踪远端 main，请切回主分支后更新。");
  return { remote, branch };
}
export async function ensureUnchanged(root, plan) {
  if (await checkoutVersion(root) !== plan.previous || (await branchSource(root)).branch !== plan.branch)
    throw Error("更新期间本地分支已切换，请重新检查更新。");
  if (await git(root, "status", "--porcelain", "--untracked-files=no"))
    throw Error("本地有未提交的文件，请先提交或暂存到 Git stash，再更新。");
}
export async function advanceCheckout(root, plan) {
  if (!plan.branch) return;
  await ensureUnchanged(root, plan);
  await git(root, "merge", "--ff-only", plan.id).catch(() => { throw Error("本地分支无法快进到 main，已保留当前版本。"); });
}
async function download(url, timeout = 120000) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeout), headers: { "User-Agent": "CartoonStudio-Updater" } });
  if (!response.ok) throw Error("下载更新失败（HTTP " + response.status + "），请稍后重试。");
  return response;
}
async function npmCli(root, temp) {
  const bin = path.dirname(process.execPath);
  const candidates = [process.env.npm_execpath, path.join(bin, "../lib/node_modules/npm/bin/npm-cli.js"),
    path.join(bin, "node_modules/npm/bin/npm-cli.js"), path.join(root, "runtime/sdk/lib/node_modules/npm/bin/npm-cli.js"),
    path.join(root, "runtime/sdk/node_modules/npm/bin/npm-cli.js")];
  const installed = candidates.find(p => p && path.basename(p) === "npm-cli.js" && existsSync(p));
  if (installed) return installed;
  // Offline distributions ship Node without npm. Bootstrap its pinned, self-contained CLI for the update.
  const bytes = Buffer.from(await (await download("https://registry.npmjs.org/npm/-/npm-11.6.2.tgz")).arrayBuffer());
  const checksum = "7iKzNfy8lWYs3zq4oFPa8EXZz5xt9gQNKJZau3B1ErLBb6bF7sBJ00x09485DOvRT2l5Gerbl3VlZNT57MxJVA==";
  if (createHash("sha512").update(bytes).digest("base64") !== checksum) throw Error("更新工具校验失败，请重试。");
  await writeFile(path.join(temp, "npm.tgz"), bytes);
  await command("tar", ["-xzf", "npm.tgz"], temp);
  return path.join(temp, "package/bin/npm-cli.js");
}

export async function prepareUpdate(root, installed, progress) {
  const previous = await checkoutVersion(root);
  let id, branch;
  if (previous) {
    const source = await branchSource(root);
    branch = source.branch;
    // A private ref pins the exact main fetched for this build without touching the checkout.
    await git(root, "fetch", "--no-tags", source.remote, "+refs/heads/main:refs/studio-update/main")
      .catch(() => { throw Error("无法拉取远端 main，请检查网络和仓库访问权限。"); });
    id = await git(root, "rev-parse", "refs/studio-update/main^{commit}");
    if (id === installed && id === previous) return null;
    await ensureUnchanged(root, { previous, branch });
    await git(root, "merge-base", "--is-ancestor", previous, id).catch(() => { throw Error("本地有远端 main 未包含的提交，请先同步分支。"); });
  } else {
    id = (await (await download("https://api.github.com/repos/" + repository + "/commits/main", 20000)).json()).sha;
    if (id === installed) return null;
  }
  if (!revision.test(id)) throw Error("未取得有效的主分支版本。");
  const base = updateDir(root), directory = path.join(base, id);
  const plan = { id, directory, previous, branch };
  if (existsSync(path.join(directory, "server/serve.mjs"))) return plan;
  const temp = await mkdtemp(path.join(base, "prepare-"));
  try {
    progress("正在下载主分支代码…");
    const stage = path.join(temp, "app"), archive = path.join(temp, "source.tar");
    await mkdir(stage);
    if (previous) {
      await git(root, "archive", "--format=tar", "--output=" + archive, id);
      await command("tar", ["-xf", archive, "-C", stage], temp);
    } else {
      const file = await download("https://codeload.github.com/" + repository + "/tar.gz/" + id);
      await writeFile(archive, Buffer.from(await file.arrayBuffer()));
      await command("tar", ["-xzf", archive, "--strip-components=1", "-C", stage], temp);
    }
    progress("正在安装依赖…");
    const npm = await npmCli(root, temp);
    const env = { PATH: path.dirname(process.execPath) + path.delimiter + process.env.PATH, STUDIO_BUILD_REVISION: id };
    await command(process.execPath, [npm, "ci", "--include=dev", "--no-audit", "--no-fund"], stage, 600000, env)
      .catch(() => { throw Error("依赖安装失败，请检查 npm 网络连接和磁盘空间后重试。"); });
    progress("正在构建新版本…");
    await command(process.execPath, [npm, "run", "build"], stage, 300000, env)
      .catch(() => { throw Error("主分支构建失败，当前版本仍可使用。"); });
    await access(path.join(stage, "dist/client/index.html"));
    await access(path.join(stage, "server/serve.mjs"));
    await access(path.join(stage, "server/studio-supervisor.mjs"));
    await rename(stage, directory);
    return plan;
  } finally { await rm(temp, { recursive: true, force: true }); }
}
