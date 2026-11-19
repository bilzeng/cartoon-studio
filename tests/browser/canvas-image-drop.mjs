import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";
import { makeNode } from "../../shared/studio.js";

test("拖入图片按落点建节点，拖到图片卡片或编辑区时添加上游参考", async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "studio-image-drop-"));
  process.env.STUDIO_DATA_DIR = dataDir;
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const vite = await createServer({ server: { port: 0, hmr: false }, logLevel: "error" });
  await vite.listen();
  t.after(() => vite.close());
  const base = vite.resolvedUrls.local[0];
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 920 } });
  page.setDefaultTimeout(7000);
  const target = makeNode("image", { x: 100, y: 100 }, { title: "参考目标", assetId: "coast" });
  const create = await page.request.post(base + "api/projects", {
    data: { board: { name: "拖拽导入验证", nodes: [target], edges: [], order: [] } },
  });
  assert.equal(create.status(), 201);
  const { id } = await create.json();
  const endpoint = base + "api/projects/" + id;
  await page.route("**/api/engine", (route) => route.fulfill({ json: {
    online: true,
    imageModels: [{ id: "test", name: "测试模型", reference: true, maxRefs: 5 }],
  } }));
  await page.goto(base + "#project/" + id);
  const workspace = page.locator(".flow-workspace");
  const pane = page.locator(".react-flow__pane");
  const tile = page.locator('.react-flow__node[data-id="' + target.id + '"] .flow-tile-face');
  await tile.waitFor();

  async function file(name) {
    const buffer = await readFile(new URL("../../public/stills/" + name, import.meta.url));
    const copy = Buffer.concat([buffer, Buffer.from("drag upload fixture")]);
    return { name: "拖入-" + name, type: "image/jpeg", bytes: copy.toString("base64") };
  }
  async function drop(zone, files, label, position = {}) {
    const dataTransfer = await page.evaluateHandle((entries) => {
      const transfer = new DataTransfer();
      for (const { name, type, bytes } of entries)
        transfer.items.add(new File([Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0))], name, { type }));
      return transfer;
    }, files);
    const event = { dataTransfer, ...position };
    await zone.dispatchEvent("dragover", event);
    await workspace.getByText(label, { exact: true }).waitFor();
    const saved = page.waitForResponse((response) =>
      response.url() === endpoint && response.request().method() === "PUT" && response.ok());
    await zone.dispatchEvent("drop", event);
    const board = await (await saved).json();
    await workspace.getByText("正在上传图片…", { exact: true }).waitFor({ state: "hidden" });
    await dataTransfer.dispose();
    return board;
  }

  const pointer = { clientX: 1000, clientY: 240 };
  const point = await pane.evaluate((el, { clientX, clientY }) => {
    const rect = el.getBoundingClientRect();
    const transform = new DOMMatrixReadOnly(getComputedStyle(el.querySelector(".react-flow__viewport")).transform);
    return { x: (clientX - rect.left - transform.e) / transform.a, y: (clientY - rect.top - transform.f) / transform.d };
  }, pointer);
  let board = await drop(pane, [
    await file("operator.jpg"),
    { name: "笔记.txt", type: "text/plain", bytes: Buffer.from("test").toString("base64") },
    await file("dial.jpg"),
  ], "松开上传图片", pointer);
  assert.equal(board.nodes.length, 3);
  assert.equal(board.edges.length, 0);
  assert.deepEqual(board.nodes.slice(1).map((n) => n.data.title), ["拖入-operator.jpg", "拖入-dial.jpg"]);
  assert.ok(Math.abs(board.nodes[1].position.x + 182 - point.x) < 2);
  assert.ok(Math.abs(board.nodes[1].position.y + 102.5 - point.y) < 2);
  assert.ok(board.nodes[2].position.x > board.nodes[1].position.x + 364);
  await page.getByText(/笔记\.txt.*PNG、JPG 或 WebP/).waitFor();

  board = await drop(tile, [await file("flare.jpg")], "松开添加为参考图");
  assert.equal(board.nodes.length, 4);
  assert.equal(board.edges[0].target, target.id);
  assert.equal(board.edges[0].source, board.nodes[3].id);
  assert.equal(board.nodes[0].data.assetId, "coast");

  await tile.click();
  const composer = page.locator(".node-composer");
  await composer.getByRole("button", { name: "上传", exact: true }).waitFor();
  const duplicate = await file("dawn.jpg");
  board = await drop(composer, [duplicate, duplicate], "松开添加为参考图");
  assert.equal(board.nodes.length, 5);
  assert.equal(board.nodes[4].data.title, "拖入-dawn.jpg");
  assert.deepEqual(board.edges.map((e) => e.target), [target.id, target.id]);
});
