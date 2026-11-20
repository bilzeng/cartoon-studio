import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";
import { makeNode } from "../../shared/studio.js";
import { h3Opening } from "../../shared/prompt-optimizer.js";

test("节点内优化提示词、保留进行中的任务和行内素材预览", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "studio-opt-layout-"));
  process.env.STUDIO_DATA_DIR = dir;
  t.after(() => rm(dir, { recursive: true, force: true }));
  const vite = await createServer({
    server: { port: 0, strictPort: false, hmr: false },
    logLevel: "error",
  });
  await vite.listen();
  t.after(() => vite.close());
  const base = vite.resolvedUrls.local[0];
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({
    viewport: { width: 1366, height: 680 },
  });
  const source = "圆桌边的座钟响了。".repeat(130);
  const result = "镜头从灯罩缓缓下移，停在座钟的分针。\n".repeat(160);
  const video = makeNode(
    "video",
    { x: 0, y: 0 },
    { text: source, videoModel: "test-video" },
  );
  const image = makeNode("image", { x: 600, y: 0 }, { text: "雨中的灯塔", imageModel: "qwen" });
  const audio = makeNode("audio", { x: 1200, y: 0 }, { text: "远处的海浪", audioModel: "sound" });
  const utility = makeNode("audio", { x: 1800, y: 0 }, { audioModel: "extract" });
  const created = await page.request.post(base + "api/projects", {
    data: { board: { name: "长稿验证", nodes: [video, image, audio, utility], edges: [], order: [] } },
  });
  assert.equal(created.status(), 201);
  const board = await created.json();
  await page.route("**/api/engine", (r) =>
    r.fulfill({
      json: {
        online: true,
        imageModels: [{ id: "qwen", name: "Qwen Image", family: "qwen21" }],
        audioModels: [
          { id: "sound", name: "音效", workflow: true, fields: [], mediaSlots: {} },
          { id: "extract", name: "提取音轨", workflow: true, hasPrompt: false, fields: [], mediaSlots: {} },
        ],
        videoModels: [
          { id: "test-video", name: "测试视频", fields: [] },
          { id: "test-h3", name: "H3 Hybrid", family: "h3", kind: "video",
            workflow: true, maxRefs: 9, minRefs: 0, fields: [], mediaSlots: { image: 9 } },
        ],
      },
    }),
  );
  const profiles = [
    { id: "p", name: "分镜助手", model: "test" },
    { id: "q", name: "美术指导", model: "test-2" },
  ];
  await page.route("**/api/prompt-models", (r) => r.fulfill({ json: profiles }));
  let reply = result.trim();
  const calls = [];
  let hold;
  let fail = false;
  await page.route("**/api/prompt-optimizer/run", async (r) => {
    calls.push(r.request().postDataJSON());
    if (hold) await hold;
    if (fail) return r.fulfill({ status: 502, json: { error: "服务暂时不可用" } });
    await r.fulfill({ json: { text: reply, modelName: "美术指导" } });
  });
  const button = (name) => page.getByRole("button", { name, exact: true });
  const optimize = button("优化提示词");
  const open = async (node) => {
    await page.goto(base + "#project/" + board.id + "?node=" + node.id);
    await page.getByRole("textbox", { name: { image: "图片", video: "视频", audio: "音频" }[node.data.kind] + "节点提示词" }).waitFor();
  };
  async function runAndSave(node, expectedSource) {
    const saved = page.waitForResponse(r => r.request().method() === "PUT" && r.url().endsWith("/projects/" + board.id));
    await optimize.click();
    const response = await saved;
    assert.equal(response.status(), 200);
    const data = (await (await page.request.get(base + "api/projects/" + board.id)).json()).nodes.find(n => n.id === node.id).data;
    assert.equal(data.text, reply);
    assert.equal(data[node.data.kind + "PromptOptimization"], undefined);
    assert.equal(calls.at(-1).context.scene, expectedSource);
    assert.equal(calls.at(-1).profileId, "q");
    assert.equal(await page.locator("dialog[open]").count(), 0);
  }
  await open(video);
  const picker = page.getByRole("combobox", { name: /选择优化模型/ });
  await picker.click();
  const menu = page.getByRole("listbox", { name: /选择优化模型/ });
  const bounds = await menu.boundingBox();
  const trigger = await picker.boundingBox();
  assert.ok(bounds.width >= 240);
  assert.ok(Math.abs(bounds.x + bounds.width - trigger.x - trigger.width) < 2);
  assert.equal(await menu.getByRole("option").last().innerText(), "管理提示词模型");
  await page.getByRole("option", { name: "美术指导 · test-2" }).click();
  assert.equal(calls.length, 0);
  await runAndSave(video, source);
  await page.reload();
  await page.getByRole("combobox", { name: /选择优化模型，当前为 美术指导/ }).waitFor();
  const editor = page.locator(".cm-content");
  assert.ok((await editor.innerText()).startsWith("镜头从灯罩"));
  const scroller = page.locator(".picture-editor .cm-scroller");
  const longHeight = await scroller.evaluate(el => el.clientHeight);
  const lineHeight = await editor.evaluate(el => parseFloat(getComputedStyle(el).lineHeight));
  assert.ok(Math.abs(longHeight - 3 * lineHeight) <= 1);
  const footer = page.locator(".node-composer footer").last();
  await scroller.hover();
  const footerTop = (await footer.boundingBox()).y;
  await page.mouse.wheel(0, 240);
  await page.waitForFunction(() => document.querySelector(".picture-editor .cm-scroller").scrollTop > 0);
  assert.equal((await footer.boundingBox()).y, footerTop);
  const grip = page.getByRole("separator", { name: "调整提示词框高度" });
  const locate = button("定位编辑器");
  if (await locate.isVisible()) {
    await locate.click();
    await locate.waitFor({ state: "hidden" });
  }
  const { x, y, width, height } = await grip.boundingBox();
  await page.mouse.move(x + width / 2, y + height / 2);
  await page.mouse.down();
  await page.mouse.move(x + width / 2, y + height / 2 + 88, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction(initial => document.querySelector(".cm-scroller").clientHeight > initial + 60, longHeight);
  await page.waitForFunction(() => document.querySelector(".generation-footer").getBoundingClientRect().bottom < innerHeight - 55);
  await grip.dblclick();
  assert.equal(await scroller.evaluate(el => el.clientHeight), longHeight);
  const afterResize = await (await page.request.get(base + "api/projects/" + board.id)).json();
  assert.equal(afterResize.nodes.find(n => n.id === video.id).data.text, result.trim());
  await page.setViewportSize({ width: 390, height: 740 });
  await page.waitForFunction(() => document.querySelector(".composer-anchor").offsetWidth < 390);
  await grip.press("ArrowDown");
  await page.waitForFunction(initial => document.querySelector(".cm-scroller").clientHeight > initial, longHeight);
  await page.waitForFunction(() => document.querySelector(".generation-footer").getBoundingClientRect().bottom <= innerHeight - 90);
  await grip.press("Home");
  assert.equal(await scroller.evaluate(el => el.clientHeight), longHeight);
  await page.setViewportSize({ width: 1366, height: 680 });
  for (const [node, text] of [[image, "细雨中，暖光穿过海雾。"], [audio, "远处海浪拍岸，低沉而疏缓。"]]) {
    reply = text;
    await open(node);
    await runAndSave(node, node.data.text);
    assert.equal(await editor.innerText(), text);
    assert.ok(await scroller.evaluate((el, limit) => el.clientHeight < limit && el.scrollHeight === el.clientHeight, longHeight));
    assert.equal(calls.at(-1).context.kind, node.data.kind);
  }
  await open(image);
  const first = reply = "第二次优化结果";
  await runAndSave(image, "细雨中，暖光穿过海雾。");
  fail = true;
  await optimize.click();
  await page.getByRole("alert").filter({ hasText: "服务暂时不可用" }).waitFor();
  assert.equal(await editor.innerText(), first);
  fail = false;
  const selectNode = (node) => page.locator(`.react-flow__node[data-id="${node.id}"] .flow-tile-face`).click();
  let completeBackground;
  hold = new Promise((resolve) => { completeBackground = resolve; });
  reply = "离开节点期间完成的优化稿。";
  await optimize.click();
  const waiting = button("优化中…");
  await waiting.waitFor();
  await page.mouse.click(40, 165);
  await editor.waitFor({ state: "detached" });
  await selectNode(image);
  await waiting.waitFor();
  assert.equal(await editor.innerText(), first);
  await selectNode(audio);
  assert.equal(await waiting.count(), 0);
  const completed = page.waitForResponse(r => r.request().method() === "PUT" &&
    r.url().endsWith("/projects/" + board.id) &&
    r.request().postDataJSON().nodes.find(n => n.id === image.id)?.data.text === reply);
  completeBackground();
  hold = null;
  assert.equal((await completed).status(), 200);
  assert.equal(await editor.innerText(), "远处海浪拍岸，低沉而疏缓。");
  await selectNode(image);
  assert.equal(await editor.innerText(), reply);
  await page.emulateMedia({ reducedMotion: "reduce" });
  let release;
  hold = new Promise(resolve => { release = resolve; });
  const started = page.waitForRequest("**/api/prompt-optimizer/run");
  await optimize.click();
  await started;
  assert.ok(await waiting.isDisabled());
  assert.equal(await waiting.locator(".generation-spin").evaluate(el => getComputedStyle(el).animationDuration), "1s");
  await waiting.getByText(/[1-9] 秒/).waitFor();
  // Even when tools wrap, the menu remains aligned with the first row.
  const more = button("节点操作");
  const firstTool = button("上传");
  assert.ok(Math.abs((await more.boundingBox()).y - (await firstTool.boundingBox()).y) <= 2);
  await more.click();
  assert.equal(await more.getAttribute("aria-expanded"), "true");
  await more.click();
  await editor.fill("我刚改好的文案");
  release();
  hold = null;
  await optimize.waitFor();
  assert.equal(await editor.innerText(), "我刚改好的文案");
  hold = new Promise(resolve => { release = resolve; });
  await optimize.click();
  await button("取消优化").click();
  await optimize.waitFor();
  release();
  hold = null;
  assert.equal(await editor.innerText(), "我刚改好的文案");
  reply = "新的文案已优化。";
  await runAndSave(image, "我刚改好的文案");
  await editor.fill("  ");
  assert.ok(await optimize.isDisabled());
  await open(utility);
  assert.equal(await optimize.count(), 0);

  const coast = makeNode("image", { x: 0, y: 0 }, { title: "海岸", assetId: "coast" });
  const actor = makeNode("image", { x: 0, y: 275 }, { title: "人物", assetId: "operator" });
  const nativeText = h3Opening + "\nintegrated_multimodal_description: <Picture 1> walks past <Picture 2>.";
  const h3 = makeNode("video", { x: 580, y: 0 }, {
    videoModel: "test-h3", text: nativeText, imageRefOrder: [coast.id, actor.id], canvasRefIds: [actor.id],
  });
  const nativeProject = await page.request.post(base + "api/projects", { data: { board: {
    name: "H3 行内预览",
    nodes: [coast, actor, h3],
    edges: [coast, actor].map(n => ({ id: crypto.randomUUID(), source: n.id, target: h3.id })),
    order: [],
  } } });
  assert.equal(nativeProject.status(), 201);
  const h3Board = await nativeProject.json();
  const nativeEndpoint = base + "api/projects/" + h3Board.id;
  await page.goto(base + "#project/" + h3Board.id + "?node=" + h3.id);
  const h3Prompt = page.getByRole("textbox", { name: "视频节点提示词" });
  const pictureOne = h3Prompt.locator('[data-token="<Picture 1>"]').first();
  await pictureOne.locator("img").waitFor({ state: "attached" });
  assert.match(await pictureOne.locator("img").getAttribute("src"), /operator/);
  assert.equal(await pictureOne.textContent(), "图二");
  assert.equal(await h3Prompt.locator('[data-token="<Picture 2>"]').count(), 0);
  if (await locate.isVisible()) await locate.click();
  await pictureOne.click();
  const imagePreview = page.getByRole("dialog", { name: /图二 素材预览/ });
  await imagePreview.waitFor();
  assert.match(await imagePreview.locator("img").first().getAttribute("src"), /operator/);
  await imagePreview.getByRole("button", { name: "关闭预览" }).click();

  await button("生成设置").click();
  const settings = page.getByRole("dialog", { name: "视频生成设置" });
  await settings.getByRole("button", { name: "清除勾选" }).click();
  await settings.getByRole("button", { name: /^图一 / }).click();
  await settings.getByRole("button", { name: "完成", exact: true }).click();
  assert.equal(await pictureOne.textContent(), "图一");
  assert.match(await pictureOne.locator("img").getAttribute("src"), /coast/);
  await page.locator(".flow-status").getByText("已保存", { exact: true }).waitFor();
  const persisted = await (await page.request.get(nativeEndpoint)).json();
  assert.equal(persisted.nodes.find(n => n.id === h3.id).data.text, nativeText);
});
