import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

test("旧作品按项目名归档，共享引用、同名文件、重命名与重新启动保留身份", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "studio-project-files-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  process.env.STUDIO_DATA_DIR = dir;
  const projects = path.join(dir, "projects");
  const media = path.join(dir, "media");
  await mkdir(projects);
  await mkdir(media);
  const save = (file, data) => writeFile(file, JSON.stringify(data));
  const board = {
    id: "one", name: "灯塔", revision: 4, updated: "2026-01-01", nodes: [], order: [],
    referenceCards: [{ imageId: "photo" }],
  };
  await save(path.join(projects, "one.json"), board);
  await save(path.join(projects, "two.json"), { ...board, id: "two" });
  const input = [
    { id: "photo", name: "海岸.png", file: "photo.png", kind: "image" },
    { id: "result", name: "海岸.png", file: "result.png", kind: "image" },
    { id: "film", name: "全片", file: "film.mp4", kind: "video" },
  ];
  await save(path.join(dir, "assets.json"), input);
  await save(path.join(dir, "jobs.json"), [
    { assetId: "result", project: "one", type: "image" },
    { assetId: "film", project: "one", type: "export" },
  ]);
  for (const a of input) await writeFile(path.join(media, a.file), a.id);
  const { organizeWorkspace, findBoard, locateAssetFile, allAssets, storeAsset, persistBoard } = await import("../server/project-files.mjs");
  await organizeWorkspace();
  await organizeWorkspace();
  const one = await findBoard("one"), two = await findBoard("two");
  assert.deepEqual([one.folder, two.folder].sort(), ["灯塔", "灯塔 (2)"].sort());
  const assets = await allAssets();
  for (const a of input) {
    const stored = assets.find(item => item.id === a.id);
    assert.equal(stored.url, "/media/" + a.file);
    assert.equal(stored.md5, createHash("md5").update(a.id).digest("hex"));
    assert.equal(await readFile(path.join(media, stored.diskFile), "utf8"), a.id);
    const repeated = await storeAsset(Buffer.from(a.id), path.extname(a.file).slice(1), a.kind,
      "不同文件名", { projectId: "two", importTags: ["新标签"] });
    assert.equal(repeated.duplicate, true);
    assert.equal(repeated.id, a.id);
    assert.equal(repeated.importTags, undefined);
  }
  const contents = (folder, file) => readFile(path.join(projects, folder, file), "utf8");
  for (const folder of [one.folder, two.folder]) assert.equal(await contents(folder, "素材/图片/海岸.png"), "photo");
  assert.equal(await contents(one.folder, "生成结果/图片/海岸 (2).png"), "result");
  assert.equal(await contents(one.folder, "导出成片/全片.mp4"), "film");
  const [a,b] = await Promise.all(["a","b"].map(bytes => storeAsset(bytes, "wav", "audio", "对白", { projectId: "one" })));
  assert.notEqual(a.diskFile, b.diskFile);
  const concurrent = await Promise.all(["one", "two"].map(projectId =>
    storeAsset("shared-audio", "wav", "audio", "共享音频", { projectId })));
  assert.equal(concurrent[0].id, concurrent[1].id);
  assert.equal(concurrent.filter(item => !item.duplicate).length, 1);
  assert.equal((await readdir(path.join(media, "音频"))).length, 3);
  const anotherTake = await storeAsset("shared-audio", "wav", "audio", "新候选", { projectId: "one", origin: "generated" });
  assert.notEqual(anotherTake.id, concurrent[0].id);
  await persistBoard("one", { ...board, name: "新/灯塔" }, 4);
  await assert.rejects(persistBoard("one", board, 4), { status: 409 });
  assert.equal((await findBoard("one")).folder, "新_灯塔");
  const asset = id => assets.find(a => a.id === id);
  assert.equal(await locateAssetFile(asset("result"), "one"), path.join(projects, "新_灯塔", "生成结果/图片/海岸 (2).png"));
  assert.equal(await locateAssetFile(asset("film"), "one"), path.join(projects, "新_灯塔", "导出成片/全片.mp4"));
  assert.equal(await locateAssetFile(asset("photo"), "two"), path.join(projects, two.folder, "素材/图片/海岸.png"));
  assert.equal(await locateAssetFile(asset("result"), "two"), path.join(media, asset("result").diskFile));
  await assert.rejects(locateAssetFile({ file: "missing.png" }), { status: 404 });
  for (const item of [a,b]) assert.equal(await contents("新_灯塔", "素材/" + item.diskFile), item.id === a.id ? "a" : "b");
  assert.ok(!(await readdir(projects)).includes("one.json"));
  assert.equal(JSON.parse(await contents("新_灯塔", "画布.json")).revision, 5);
});
