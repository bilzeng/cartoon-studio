import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import { createServer } from "vite";
import { makeNode } from "../../shared/studio.js";

test("框选素材可从任一选中端口批量接入现有节点或新建下游节点", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "studio-batch-wires-"));
  process.env.STUDIO_DATA_DIR = dir;
  t.after(() => rm(dir, { recursive: true, force: true }));
  const server = await createServer({ server: { port: 0, hmr: false }, logLevel: "error" });
  await server.listen();
  t.after(() => server.close());
  const base = server.resolvedUrls.local[0];
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 880 } });
  page.setDefaultTimeout(10000);
  await page.route("**/api/engine", (route) => route.fulfill({
    json: { online: true, videoModels: [
      { id: "single", name: "单张参考", needsImage: true, maxRefs: 1 },
      { id: "multi", name: "多图参考", workflow: true, maxRefs: 3 },
    ] },
  }));

  const first = makeNode("image", { x: 0, y: 0 }, { title: "海岸", assetId: "coast" });
  const second = makeNode("image", { x: 0, y: 320 }, { title: "人物", assetId: "operator" });
  const video = makeNode("video", { x: 660, y: 0 }, { title: "合成镜头" });
  const image = makeNode("image", { x: 660, y: 320 }, { title: "合成图片" });
  const request = await page.request.post(base + "api/projects", {
    data: { board: {
      name: "批量连线",
      nodes: [first, second, video, image],
      edges: [{ id: "existing", source: second.id, target: image.id }],
      order: [],
    } },
  });
  assert.equal(request.status(), 201);
  const board = await request.json();
  const endpoint = base + "api/projects/" + board.id;
  const read = async () => (await page.request.get(endpoint)).json();
  const tile = (id) => page.locator('.react-flow__node[data-id="' + id + '"] .flow-tile-face');
  const button = (name) => page.getByRole("button", { name, exact: true });
  const composer = page.locator(".composer-anchor");
  const saved = () => page.waitForFunction(() => document.querySelector(".flow-status")?.textContent === "已保存");
  const center = async (locator) => {
    const { x, y, width, height } = await locator.boundingBox();
    return { x: x + width / 2, y: y + height / 2 };
  };
  async function drag(from, to) {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 18 });
  }
  async function selectBoth() {
    const a = await tile(first.id).boundingBox();
    const b = await tile(second.id).boundingBox();
    await drag(
      { x: a.x + a.width + 72, y: a.y + 20 },
      { x: b.x + b.width / 2, y: b.y + b.height - 20 },
    );
    await page.mouse.up();
    await page.getByText("已选 2 个节点").waitFor();
  }
  function assertLinks(current, target) {
    assert.deepEqual(
      current.edges.filter((edge) => edge.target === target).map((edge) => edge.source).sort(),
      [first.id, second.id].sort(),
    );
  }

  await page.goto(base + "#project/" + board.id);
  await tile(first.id).locator("img.ready").waitFor();
  const secondOutput = button("人物 · 添加下游");
  await selectBoth();
  await drag(await center(secondOutput), await center(button("合成镜头 · 添加上游")));
  await page.locator(".flow-port.connectingto.valid").waitFor();
  await page.mouse.up();
  await saved();
  const wired = await read();
  assertLinks(wired, video.id);
  const videoData = wired.nodes.find((n) => n.id === video.id).data;
  assert.equal(videoData.videoModel, "multi");
  assert.equal(videoData.text, "@图1 @图2");
  assert.equal(await composer.count(), 0);

  // Starting at an already-connected source still attaches the remaining selection.
  await selectBoth();
  await drag(await center(secondOutput), await center(tile(image.id)));
  await page.locator('[data-wire-target="batch"]').waitFor();
  await page.mouse.up();
  await saved();
  const joined = await read();
  assertLinks(joined, image.id);
  assert.ok(joined.edges.some((edge) => edge.id === "existing"));

  await selectBoth();
  const rightOfSources = await center(secondOutput);
  await drag(rightOfSources, { x: rightOfSources.x + 120, y: rightOfSources.y - 80 });
  await page.mouse.up();
  const palette = page.getByRole("group", { name: "节点类型" });
  await palette.getByText("引用所选节点生成").waitFor();
  assert.equal(await composer.count(), 0);
  await palette.getByRole("button", { name: "视频", exact: true }).click();
  await saved();
  const created = await read();
  const extra = created.nodes.filter((n) => !board.nodes.some((prior) => prior.id === n.id));
  assert.equal(extra.length, 1);
  assert.equal(extra[0].data.videoModel, "multi");
  assertLinks(created, extra[0].id);
});
