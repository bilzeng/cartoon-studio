import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import { createServer } from "vite";
import { makeNode } from "../../shared/studio.js";

test("预设提示词弹窗分类搜索并预览，确认后追加到原文", async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "studio-prompt-presets-"));
  process.env.STUDIO_DATA_DIR = dataDir;
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const vite = await createServer({ server: { port: 0, hmr: false }, logLevel: "error" });
  await vite.listen();
  t.after(() => vite.close());
  const base = vite.resolvedUrls.local[0];
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 780 } });
  page.setDefaultTimeout(6000);

  const image = makeNode("image", { x: 0, y: 0 }, { text: "已有构图" });
  const audio = makeNode("audio", { x: 420, y: 0 }, { audioModel: "voice" });
  const project = await page.request.post(base + "api/projects", {
    data: { board: { name: "测试提示词库", nodes: [image, audio], edges: [], order: [] } },
  });
  assert.equal(project.status(), 201);
  const { id } = await project.json();
  await page.route("**/api/engine", (route) => route.fulfill({ json: {
    online: true,
    imageModels: [{ id: "image", name: "图片模型", kind: "image" }],
    audioModels: [{
      id: "voice", name: "旁白模型", kind: "audio", workflow: true, verbatim: true,
      hasPrompt: true, fields: [], controls: [], maxRefs: 0,
    }],
  } }));
  const projectUrl = base + "#project/" + id;
  await page.goto(projectUrl + "?node=" + image.id);
  const open = page.getByRole("button", { name: "预设提示词", exact: true });
  const dialog = page.getByRole("dialog", { name: "预设提示词" });
  const categories = dialog.getByRole("group", { name: "提示词分类" });
  const options = dialog.getByRole("group", { name: "提示词样例" });
  const preview = dialog.getByRole("region", { name: "提示词预览" });
  await open.click();
  assert.equal(await options.getByRole("button").count(), 48);
  await categories.getByRole("button", { name: "人物肖像" }).click();
  assert.equal(await options.getByRole("button").count(), 7);
  await options.getByRole("button", { name: "手艺人 · 工作肖像" }).click();
  assert.match(await preview.innerText(), /打磨一件器物/);
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  const saved = async () => (await page.request.get(base + "api/projects/" + id)).json();
  assert.equal((await saved()).nodes[0].data.text, "已有构图");

  await open.click();
  const search = dialog.getByRole("searchbox", { name: "搜索预设提示词" });
  await search.fill("没有这样的关键词");
  const apply = dialog.getByRole("button", { name: "追加到提示词" });
  assert.ok(await apply.isDisabled());
  await search.fill("江南 团扇");
  assert.equal(await options.getByRole("button").count(), 1);
  const text = await preview.locator("p").innerText();
  await page.setViewportSize({ width: 390, height: 640 });
  const bounds = await dialog.boundingBox();
  const action = await apply.boundingBox();
  assert.ok(action.y + action.height <= bounds.y + bounds.height);
  await apply.click();
  await dialog.waitFor({ state: "hidden" });
  let board;
  for (let i = 0; i < 20; i++) {
    board = await saved();
    if (board.nodes[0].data.text !== "已有构图") break;
    await delay(70);
  }
  assert.equal(board.nodes[0].data.text, "已有构图\n" + text);

  await page.setViewportSize({ width: 1440, height: 780 });
  await page.goto(projectUrl + "?node=" + audio.id);
  await open.click();
  assert.ok(await categories.getByRole("button", { name: "旁白与对白" }).isVisible());
  assert.equal(await categories.getByRole("button", { name: "环境音效" }).count(), 0);
  assert.equal(await options.getByRole("button").count(), 5);
  assert.ok(await dialog.getByRole("button", { name: "使用此预设" }).isEnabled());
});
