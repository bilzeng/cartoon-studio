import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";
import { makeNode } from "../../shared/studio.js";
import { videoUpscale2kId, videoUpscale4kId } from "../../shared/generation-size.js";

test("从已选成片创建高清修复节点，切换至 4K 并查看生成进度", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "studio-upscale-"));
  process.env.STUDIO_DATA_DIR = dir;
  t.after(() => rm(dir, { recursive: true, force: true }));
  const vite = await createServer({
    server: { port: 0, hmr: false },
    logLevel: "error",
  });
  await vite.listen();
  t.after(() => vite.close());
  const base = vite.resolvedUrls.local[0];
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  page.setDefaultTimeout(6000);
  const clip = await page.request.post(base + "api/assets?name=original.mp4", {
    headers: { "Content-Type": "application/octet-stream" },
    data: Buffer.from([0, 0, 0, 20, ...Buffer.from("ftypisom"), 0, 0, 0, 0]),
  });
  assert.equal(clip.status(), 201);
  const asset = await clip.json();
  const source = makeNode(
    "video",
    { x: 0, y: 0 },
    { assetId: asset.id, title: "成片" },
  );
  const response = await page.request.post(base + "api/projects", {
    data: {
      board: { name: "超分测试", nodes: [source], edges: [], order: [] },
    },
  });
  const board = await response.json();
  await page.route("**/api/engine", (r) =>
    r.fulfill({
      json: {
        online: true,
        videoModels: [
          { id: "generator", name: "视频生成", hasPrompt: true },
          ...[videoUpscale2kId, videoUpscale4kId].map(id => ({
            id, name: "视频高清修复 " + (id === videoUpscale2kId ? "2K" : "4K"),
            workflow: true,
            hasPrompt: false,
            fields: [],
            controls: [],
            mediaSlots: { video: 1 },
            maxRefs: 0,
            outputSize: id === videoUpscale2kId ? [2560, 1440] : [3840, 2160],
          })),
        ],
      },
    }),
  );
  let job;
  await page.route("**/api/jobs?*ids=*", r => r.fulfill({ json: job ? [job] : [] }));
  await page.route("**/nodes/*/jobs*", (r) =>
    r.fulfill({ json: job ? [job] : [] }),
  );
  await page.route("**/generate", (r) => {
    job = {
      id: "upscale-test",
      phase: "waiting",
      queuePosition: 2,
      status: "running",
      created: new Date().toISOString(),
      step: {
        stage: "超分采样",
        value: 2,
        max: 8,
        updatedAt: new Date().toISOString(),
      },
    };
    return r.fulfill({ status: 202, json: { id: job.id } });
  });
  await page.goto(base + "#project/" + board.id + "?node=" + source.id);
  const downloading = page.waitForEvent("download");
  await page.getByRole("link", { name: "下载视频" }).click();
  const download = await downloading;
  assert.equal(download.suggestedFilename(), "original.mp4");
  assert.equal(await download.failure(), null);
  await page.getByRole("button", { name: "高清修复", exact: true }).click();
  assert.equal(job, undefined);
  await page.getByRole("combobox", { name: "输出清晰度" }).click();
  await page.getByRole("option", { name: /4K/ }).click();
  await page.getByRole("button", { name: "开始放大", exact: true }).click();
  await page.locator(".flow-tile-face").getByText("工作台排队第 2 位").waitFor();
  const result = page.locator(".generation-result");
  await result.getByText("工作台排队第 2 位", { exact: true }).waitFor();
  const waitingHeight = (await result.boundingBox()).height;
  const stage = "超分采样，生成高清画面并恢复片段细节".repeat(8);
  job = {
    ...job, phase: "executing", queuePosition: undefined,
    step: { ...job.step, stage }, progressStream: "offline",
  };
  const bar = result.getByRole("progressbar", { name: stage });
  await bar.waitFor();
  assert.equal((await result.boundingBox()).height, waitingHeight);
  assert.ok(waitingHeight <= 38);
  await page.setViewportSize({ width: 390, height: 740 });
  assert.equal((await result.boundingBox()).height, waitingHeight);
  assert.match(await result.locator(".generation-status").getAttribute("title"), /恢复片段细节/u);
  assert.match(await result.locator(".job-timing").getAttribute("title"), /步骤连接中断，正在重连.*上次更新/u);
  await page.setViewportSize({ width: 1440, height: 900 });
  const tile = page.locator(".flow-tile-face[data-generating]");
  assert.ok(await tile.locator(".tile-generation").isVisible());
  assert.equal((await tile.innerText()).trim(), "");
  assert.equal(await page.getByText("第 2 / 8 步").count(), 1);
  assert.equal(await bar.getAttribute("aria-valuenow"), "2");
  assert.equal(await bar.getAttribute("aria-valuemax"), "8");
  assert.ok(await page.getByText("第 2 / 8 步").isVisible());
  const saved = await (
    await page.request.get(base + "api/projects/" + board.id)
  ).json();
  assert.equal(
    saved.nodes.find((n) => n.id === source.id).data.assetId,
    asset.id,
  );
  const downstream = saved.nodes.find(
    (n) => n.data.videoModel === videoUpscale4kId,
  );
  assert.ok(
    saved.edges.some(
      (e) => e.source === source.id && e.target === downstream.id,
    ),
  );
  await page.route("**/api/jobs/upscale-test/cancel", r => {
    assert.equal(r.request().method(), "POST");
    job = { ...job, status: "cancelled", finishedAt: new Date().toISOString(), detail: "已取消生成" };
    return r.fulfill({ json: job });
  });
  await page.getByRole("button", { name: "取消生成", exact: true }).click();
  await page.getByText("已取消生成", { exact: true }).waitFor();
  await page.locator(".flow-tile-face[data-generating]").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "开始放大", exact: true }).waitFor();
});
