import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";
import { makeNode } from "../../shared/studio.js";
import { videoUpscale2kId, videoUpscale4kId } from "../../shared/generation-size.js";

test("新旧高清成片与生成时的原片同步拖动、播放和放大", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "studio-video-comparison-"));
  process.env.STUDIO_DATA_DIR = dir;
  t.after(() => rm(dir, { recursive: true, force: true }));
  const app = await createServer({ server: { port: 0, hmr: false }, logLevel: "error" });
  await app.listen();
  t.after(() => app.close());
  const base = app.resolvedUrls.local[0];
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const upload = async (name, size) => {
    const file = path.join(dir, name + ".webm");
    execFileSync("ffmpeg", ["-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=" + size + ":rate=24",
      "-t", "3", "-c:v", "libvpx", "-deadline", "realtime", file]);
    const res = await page.request.post(base + "api/assets?name=" + name + ".webm", {
      headers: { "Content-Type": "application/octet-stream" }, data: await readFile(file),
    });
    assert.equal(res.status(), 201);
    return res.json();
  };
  const source = await upload("one", "224x128");
  const target = await upload("two", "320x180");
  const newer = await upload("three", "384x216");
  const a = makeNode("video", { x: 0, y: 0 }, { assetId: newer.id });
  const b = makeNode("video", { x: 455, y: 0 }, { assetId: target.id, videoModel: videoUpscale2kId });
  const board = await (await page.request.post(base + "api/projects", { data: { board: {
    name: "视频修复对比", nodes: [a, b], edges: [{ id: "wire", source: a.id, target: b.id }], order: [],
  } } })).json();
  const job = { project: board.id, type: "video", nodeId: b.id, status: "done", created: new Date().toISOString() };
  await writeFile(path.join(dir, "jobs.json"), JSON.stringify([
    { ...job, id: "legacy", detail: "视频高清修复 · RelayVSR 二采 2K · one", inputAssetIds: [source.id], assetId: target.id },
    { ...job, id: "new", modelId: videoUpscale4kId, inputAssetIds: [target.id], assetId: newer.id },
  ]));
  await page.route("**/api/engine", r => r.fulfill({ json: { online: false } }));
  await page.goto(base + "#project/" + board.id + "?node=" + b.id);
  const tile = page.locator('.react-flow__node[data-id="' + b.id + '"]');
  const split = tile.getByRole("slider", { name: "修复前后对比" });
  await split.waitFor();
  assert.equal(await tile.getByLabel("修复前的视频").getAttribute("src"), source.url);
  assert.equal(await page.locator('.react-flow__node[data-id="' + a.id + '"]').getByLabel("修复前的视频").getAttribute("src"), target.url);
  const frame = await tile.locator(".restore-comparison").boundingBox();
  await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2);
  await page.mouse.down();
  await page.mouse.move(frame.x + frame.width * 0.18, frame.y + frame.height / 2, { steps: 4 });
  await page.mouse.up();
  assert.ok(Math.abs(Number(await split.getAttribute("aria-valuenow")) - 18) <= 1);
  await tile.getByRole("button", { name: "播放对比" }).click();
  const primary = tile.getByLabel("修复后的视频");
  const paired = await primary.elementHandle();
  await page.waitForFunction(v => v.currentTime > 0.3 && !v.nextElementSibling.paused &&
    Math.abs(v.currentTime - v.nextElementSibling.currentTime) < 0.08, paired);
  const aligned = v => v.paused && v.nextElementSibling.paused && !v.seeking &&
    !v.nextElementSibling.seeking && Math.abs(v.currentTime - v.nextElementSibling.currentTime) < 0.01;
  await tile.getByRole("button", { name: "暂停对比" }).click();
  await page.waitForFunction(aligned, paired);
  const seek = tile.getByRole("slider", { name: "对比视频进度" });
  const track = await seek.boundingBox();
  await page.mouse.click(track.x + track.width * 0.65, track.y + track.height / 2);
  await page.waitForFunction(aligned, paired);
  const at = await primary.evaluate(v => v.currentTime);
  assert.ok(at > 1 && at < 2.5);
  assert.equal(await tile.getByLabel("修复前的视频").evaluate(v => v.muted), true);
  await page.getByRole("button", { name: "对比原片" }).click();
  const viewer = page.getByRole("dialog");
  const large = viewer.getByRole("slider", { name: "修复前后对比" });
  await large.waitFor();
  const master = await viewer.getByLabel("修复后的视频").elementHandle();
  await page.waitForFunction(({v, at}) => Math.abs(v.currentTime - at) < 0.01 &&
    Math.abs(v.currentTime - v.nextElementSibling.currentTime) < 0.01, {v: master, at});
  await large.press("End");
  assert.equal(await large.getAttribute("aria-valuenow"), "100");
  await viewer.getByRole("button", {name: "100%", exact: true}).click();
  assert.equal(await viewer.getByLabel("修复后的视频").evaluate(v => v.getBoundingClientRect().width), 320);
  await viewer.getByRole("button", { name: "播放对比" }).click();
  await large.press("Escape");
  await viewer.waitFor({ state: "hidden" });
});
