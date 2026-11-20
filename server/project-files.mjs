import path from "node:path";
import { createHash } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { copyFile, link, lstat, mkdir, mkdtemp, readdir, rename, rm } from "node:fs/promises";
import { makeId, shots } from "../shared/studio.js";
import { assetBindings, mediaFileTags, readMediaFileTags, updatedAssetUsage } from "./asset-library.mjs";
import { assetFile, atomicWrite, jobFile, mediaDir, projectsDir, readJson, root, withFileLock } from "./files.mjs";

const kinds = { image: "图片", video: "视频", audio: "音频", model: "三维模型" };
const boardFile = "画布.json";
const folders = new Map();
const builtins = shots.map(([id, name]) => ({
  id, name, kind: "image", builtin: true, url: "/stills/" + id + ".jpg",
  diskFile: "内置示例/" + name + ".jpg",
}));
const key = (name) => name.normalize("NFC").toLowerCase();
const missing = () => Object.assign(new Error("项目不存在"), { status: 404 });
const locked = (fn) => withFileLock(projectsDir, fn);
const writeJson = (file, value) => atomicWrite(file, JSON.stringify(value, null, 2) + "\n");

function safeName(name) {
  let s = String(name).normalize("NFC").replace(/[<>:"/\\|?*\p{Cc}]/gu, "_").trim();
  while (Buffer.byteLength(s) > 120) s = Array.from(s).slice(0, -1).join("");
  s = s.replace(/^[. ]+|[. ]+$/g, "") || "未命名";
  return /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(\.|$)/i.test(s) ? "_" + s : s;
}

function availableName(base, ext, used) {
  let name = base + ext;
  for (let i = 2; used.has(key(name)); i++) name = base + " (" + i + ")" + ext;
  used.add(key(name));
  return name;
}
async function entries(dir) {
  return readdir(dir, { withFileTypes: true });
}
async function boards() {
  const result = [];
  for (const e of await entries(projectsDir)) {
    if (!e.isDirectory() || e.name.startsWith(".")) continue;
    const board = await readJson(path.join(projectsDir, e.name, boardFile), null);
    if (board?.id) {
      folders.set(board.id, e.name);
      result.push({ board, folder: e.name });
    }
  }
  return result;
}
async function lookup(id) {
  if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw missing();
  const folder = folders.get(id);
  if (folder) {
    const board = await readJson(path.join(projectsDir, folder, boardFile), null);
    if (board?.id === id) return { board, folder };
  }
  return (await boards()).find((entry) => entry.board.id === id);
}
async function newFolder(name, current) {
  const taken = new Set((await readdir(projectsDir)).filter(n => !current || key(n) !== key(current)).map(key));
  return availableName(safeName(name), "", taken);
}
async function ensureDir(dir) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
}
export function assetPath(a) {
  return path.join(mediaDir, a.diskFile || path.basename(a.file));
}
function publicAsset(a) {
  return { ...a, url: a.url || "/media/" + a.file };
}
export async function allAssets() {
  return [...(await readJson(assetFile, [])).map(publicAsset), ...builtins];
}

async function exists(file) {
  try { return (await lstat(file)).isFile(); }
  catch (e) { if (e.code === "ENOENT") return false; throw e; }
}
async function fileMd5(file) {
  const hash = createHash("md5");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
// Link immutable media when the volume supports it. Never replace a destination.
async function place(source, target) {
  await ensureDir(path.dirname(target));
  try { await link(source, target); }
  catch (e) {
    if (e.code === "EEXIST") return false;
    if (!["EXDEV", "EPERM", "ENOSYS", "EOPNOTSUPP", "ENOTSUP", "EMLINK", "EACCES"].includes(e.code)) throw e;
    if (await exists(target)) return false;
    const temp = path.join(path.dirname(target), "." + makeId() + ".tmp");
    try {
      await copyFile(source, temp, constants.COPYFILE_EXCL);
      await rename(temp, target);
    } finally {
      await rm(temp, { force: true });
    }
  }
  return true;
}
function boardRefs(b) {
  return new Set(assetBindings(b).values());
}
function projectAssetPath(folder, projectId, a) {
  const own = a.projectId === projectId;
  const category = own && a.origin === "export" ? "导出成片" : own && a.origin === "generated" ? "生成结果" : "素材";
  return path.join(projectsDir, folder, category, category === "导出成片" ? path.basename(a.diskFile) : a.diskFile);
}
async function projectAsset(folder, projectId, a) {
  const target = projectAssetPath(folder, projectId, a);
  return await place(assetPath(a), target) ? target : null;
}
export async function locateAssetFile(asset, projectId) {
  if (projectId && asset.diskFile) {
    const { folder } = await findBoard(projectId);
    const file = projectAssetPath(folder, projectId, asset);
    if (await exists(file)) return file;
  }
  const file = assetPath(asset);
  if (await exists(file)) return file;
  throw Object.assign(new Error("本地素材文件已移动或删除"), { status: 404 });
}
async function allocateMedia(name, ext, kind, used, items) {
  const group = kinds[kind];
  await ensureDir(path.join(mediaDir, group));
  if (!used.has(group)) {
    const names = await readdir(path.join(mediaDir, group));
    for (const item of items) if (item.diskFile?.startsWith(group + "/")) names.push(path.basename(item.diskFile));
    used.set(group, new Set(names.map(key)));
  }
  const stem = name.replace(/\.(?:png|jpe?g|webp|mp4|mov|webm|mp3|wav|flac|ogg|m4[ab]|glb|gltf|obj)$/i, "");
  return group + "/" + availableName(safeName(stem), "." + ext, used.get(group));
}
export function storeAsset(bytes, ext, kind, name, { projectId, origin = "upload", importTags = [], model } = {}) {
  const md5 = createHash("md5").update(bytes).digest("hex");
  return locked(async () => {
    const entry = projectId ? await lookup(projectId) : null;
    if (projectId && !entry) throw missing();
    const items = await readJson(assetFile, []);
    if (origin === "upload") {
      for (const asset of [...items, ...builtins]) {
        if (asset.kind === kind && asset.md5 === md5 && await exists(assetPath(asset)))
          return { ...publicAsset(asset), duplicate: true };
      }
    }
    const id = makeId();
    const a = { id, name, kind, md5, file: id + "." + ext, fileTags: mediaFileTags(kind, bytes), created: new Date().toISOString(),
      diskFile: await allocateMedia(name, ext, kind, new Map(), items), origin, ...(projectId ? { projectId } : {}),
      ...(importTags.length ? { importTags } : {}), ...(model && {model}) };
    await atomicWrite(assetPath(a), bytes);
    let archived;
    try {
      if (entry) archived = await projectAsset(entry.folder, projectId, a);
      await writeJson(assetFile, [a, ...items]);
    } catch (error) {
      if (archived) await rm(archived, { force: true });
      await rm(assetPath(a), { force: true });
      throw error;
    }
    return publicAsset(a);
  });
}

export const listBoardFiles = () => locked(boards);
export const findBoard = (id) => locked(async () => {
  const entry = await lookup(id);
  if (!entry) throw missing();
  return entry;
});
export function persistBoard(id, board, revision) {
  return locked(async () => {
    const entry = await lookup(id);
    if ((entry?.board.revision ?? 0) !== revision)
      throw Object.assign(new Error("另一个窗口已修改项目。请先下载当前草稿，再重新打开最新版本。"), { status: 409 });
    const renamed = entry && safeName(entry.board.name) !== safeName(board.name);
    const folder = !entry || renamed ? await newFolder(board.name, entry?.folder) : entry.folder;
    const destination = path.join(projectsDir, folder);
    const dir = entry ? destination : await mkdtemp(path.join(projectsDir, ".creating-"));
    if (renamed) await rename(path.join(projectsDir, entry.folder), dir);
    const saved = { ...board, id, revision: revision + 1, updated: new Date().toISOString() };
    saved.assetUsage = updatedAssetUsage(entry?.board, board, saved.updated);
    try {
      const previous = entry ? boardRefs(entry.board) : new Set();
      const added = [...boardRefs(board)].filter(ref => !previous.has(ref));
      if (added.length) {
        const assets = new Map((await allAssets()).map(a => [a.id, a]));
        for (const ref of added) {
          const a = assets.get(ref);
          if (a) await projectAsset(path.basename(dir), id, a);
        }
      }
      await writeJson(path.join(dir, boardFile), saved);
      if (!entry) await rename(dir, destination);
    } catch (error) {
      if (!entry) await rm(dir, { recursive: true, force: true });
      if (renamed) await rename(dir, path.join(projectsDir, entry.folder));
      throw error;
    }
    folders.set(id, folder);
    return saved;
  });
}

export async function organizeWorkspace() {
  await locked(async () => {
    for (const a of builtins) {
      await place(path.join(root, "public", "stills", a.id + ".jpg"), assetPath(a));
      a.fileTags = await readMediaFileTags(a, assetPath(a));
      a.md5 = await fileMd5(assetPath(a));
    }
    const projects = await boards();
    for (const f of await entries(projectsDir)) {
      if (!f.isFile() || !/^[a-zA-Z0-9_-]+\.json$/.test(f.name)) continue;
      const file = path.join(projectsDir, f.name);
      const b = await readJson(file, null);
      if (!b?.name || !Array.isArray(b.nodes) || (b.id && b.id !== f.name.slice(0, -5))) continue;
      b.id ||= f.name.slice(0, -5);
      let entry = projects.find(p => p.board.id === b.id);
      if (!entry) {
        const folder = await newFolder(b.name);
        const staging = await mkdtemp(path.join(projectsDir, ".migrating-"));
        try {
          await writeJson(path.join(staging, boardFile), b);
          await rename(staging, path.join(projectsDir, folder));
        } finally {
          await rm(staging, { recursive: true, force: true });
        }
        entry = { folder, board: b };
        projects.push(entry);
      }
      if (JSON.stringify(entry.board) === JSON.stringify(b)) await rm(file);
    }
    const history = await readJson(jobFile, []);
    const results = new Map(history.filter(j => j.assetId).map(j => [j.assetId, j]));
    const items = await readJson(assetFile, []);
    const used = new Map();
    let changed = false;
    for (const a of items) {
      if (a.diskFile) continue;
      const job = results.get(a.id);
      const owners = projects.filter(p => boardRefs(p.board).has(a.id));
      a.projectId = job?.project || (owners.length === 1 ? owners[0].board.id : undefined);
      a.origin = job ? (job.type === "export" ? "export" : "generated") : "upload";
      a.diskFile = await allocateMedia(a.name, path.extname(a.file).slice(1), a.kind, used, items);
      changed = true;
    }
    // Commit the destination before moving legacy files, so restart resumes the same move.
    if (changed) await writeJson(assetFile, items);
    let indexed = false;
    for (const a of items) {
      const old = path.join(mediaDir, path.basename(a.file));
      if (await exists(old)) {
        if (await exists(assetPath(a))) throw new Error("素材迁移目标已存在：" + a.diskFile);
        await rename(old, assetPath(a));
      }
      const file = assetPath(a);
      if ((!a.fileTags || !a.md5) && await exists(file)) {
        a.fileTags ??= await readMediaFileTags(a, file);
        a.md5 ||= await fileMd5(file);
        indexed = true;
      }
    }
    if (indexed) await writeJson(assetFile, items);
    const sources = new Map([...items, ...builtins].map(a => [a.id, a]));
    for (const { board, folder } of projects) {
      const refs = boardRefs(board);
      for (const a of items) if (a.projectId === board.id) refs.add(a.id);
      for (const j of history) if (j.project === board.id) {
        refs.add(j.assetId);
        refs.add(j.snapshot?.imageId);
        for (const c of j.snapshot?.references || []) refs.add(c.imageId);
      }
      for (const ref of refs) {
        const a = sources.get(ref);
        if (a && await exists(assetPath(a))) await projectAsset(folder, board.id, a);
      }
    }
  });
}
