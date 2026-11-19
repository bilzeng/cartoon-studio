import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { loadEnvFile } from "node:process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import lockfile from "proper-lockfile";

export const root = fileURLToPath(new URL("../", import.meta.url));
if (!process.env.NODE_TEST_CONTEXT && existsSync(path.join(root, ".env")))
  loadEnvFile(path.join(root, ".env"));
function workspaceData() {
  if (!process.env.NODE_TEST_CONTEXT) return path.join(root, "data");
  if (process.env.STUDIO_DATA_DIR) return process.env.STUDIO_DATA_DIR;
  const temporary = mkdtempSync(path.join(tmpdir(), "studio-test-data-"));
  process.once("exit", () => rmSync(temporary, { recursive: true, force: true }));
  return temporary;
}
export const dataDir = workspaceData();
export const projectsDir = path.join(dataDir, "projects");
export const mediaDir = path.join(dataDir, "media");
await Promise.all(
  [projectsDir, mediaDir].map((dir) =>
    mkdir(dir, { recursive: true, mode: 0o700 }),
  ),
);

export async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return structuredClone(fallback);
    throw error;
  }
}
export async function atomicWrite(file, bytes) {
  const temp = file + "." + randomUUID() + ".tmp";
  const handle = await open(temp, "wx", 0o600);
  try {
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, file);
  } finally {
    await rm(temp, { force: true });
  }
}

// Re-read inside the lock so two tabs or two server processes cannot lose updates.
export async function withFileLock(file, operation) {
  const release = await lockfile.lock(file, {
    realpath: false,
    retries: { retries: 50, minTimeout: 10, maxTimeout: 100, randomize: true },
  });
  try {
    return await operation();
  } finally {
    await release();
  }
}

export function editJson(file, fallback, change) {
  return withFileLock(file, async () => {
    const next = await change(await readJson(file, fallback));
    if (next === undefined) throw new TypeError("JSON 更新缺少返回值");
    await atomicWrite(file, JSON.stringify(next, null, 2) + "\n");
    return next;
  });
}

export const assetFile = path.join(dataDir, "assets.json");
export const jobFile = path.join(dataDir, "jobs.json");
const settingsFile = path.join(dataDir, "settings.json");
const defaults = {
  active: "",
  profiles: [],
  presets: [],
  mappings: [],
  covers: [],
  preferences: [],
  styleExamples: [],
};
export const settings = () => readJson(settingsFile, defaults);
export const changeSettings = (fn) =>
  editJson(settingsFile, defaults, (state) => {
    fn(state);
    return state;
  });
