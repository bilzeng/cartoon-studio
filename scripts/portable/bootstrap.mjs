// Only source checkouts need bootstrapping. Release packages already contain these files.
import { existsSync } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";

const win = process.platform === "win32",
  name = win ? "ffmpeg.exe" : "ffmpeg",
  executable = path.join("runtime", "bin", name);
if (!existsSync(executable)) {
  const platform = process.platform + "-" + process.arch;
  const lines = (
    await readFile(new URL("./runtimes.tsv", import.meta.url), "utf8")
  )
    .trim()
    .split(/\r?\n/);
  const [, , , url, expected] = lines
    .map((l) => l.split(/\s+/))
    .find(([key]) => key === platform);
  await mkdir("runtime/bin", { recursive: true });
  const dir = await mkdtemp(path.join("runtime", "ffmpeg-"));
  try {
    console.log("正在准备视频导出工具…");
    const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
    if (!response.ok) throw Error("FFmpeg 下载失败 HTTP " + response.status);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (createHash("sha256").update(bytes).digest("hex") !== expected)
      throw Error("FFmpeg 文件校验失败");
    const file = path.join(dir, "ffmpeg.tgz");
    await writeFile(file, bytes);
    execFileSync("tar", ["-xzf", file, "-C", dir, "package/" + name]);
    const extracted = path.join(dir, "package", name);
    await chmod(extracted, 0o755);
    await rename(extracted, executable);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
const npm = win
  ? "runtime/sdk/node_modules/npm/bin/npm-cli.js"
  : "runtime/sdk/lib/node_modules/npm/bin/npm-cli.js";
const run = (args) =>
  execFileSync(process.execPath, [npm, ...args], {
    stdio: "inherit",
    env: {
      ...process.env,
      npm_config_cache: path.resolve("runtime/npm-cache"),
    },
  });
const { dependencies } = JSON.parse(await readFile("package.json", "utf8"));
const missingDependency = Object.keys(dependencies).some(name => !existsSync(path.join("node_modules", name, "package.json")));
const needsBuild = missingDependency || !existsSync("dist/client/index.html");
if (missingDependency || (needsBuild && !existsSync("node_modules/vite/package.json")))
  run(["ci", "--include=dev"]);
if (needsBuild) run(["run", "build"]);
