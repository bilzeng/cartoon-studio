import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";
import { makeNode } from "../../shared/studio.js";

test("节点内一键替换提示词、选择并记住模型，等待期间的编辑优先", async (t) => {
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
        videoModels: [{ id: "test-video", name: "测试视频", fields: [] }],
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
  await page.emulateMedia({ reducedMotion: "reduce" });
  let release;
  hold = new Promise(resolve => { release = resolve; });
  const started = page.waitForRequest("**/api/prompt-optimizer/run");
  await optimize.click();
  await started;
  const waiting = button("优化中…");
  assert.ok(await waiting.isDisabled());
  assert.equal(await waiting.locator(".generation-spin").evaluate(el => getComputedStyle(el).animationDuration), "1s");
  await waiting.getByText(/[1-9] 秒/).waitFor();
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
});
