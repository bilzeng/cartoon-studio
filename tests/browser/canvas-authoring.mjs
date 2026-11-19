import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";
import { makeNode } from "../../shared/studio.js";

test("生成面板、素材引用、框选编组与平移", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "canvas-edit-"));
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
    viewport: { width: 1440, height: 920 },
  });
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const a = makeNode(
    "image",
    { x: 0, y: 0 },
    { title: "coast.jpg", assetId: "coast" },
  );
  const b = makeNode(
    "image",
    { x: 520, y: 0 },
    { title: "海岸分镜", assetId: "operator", text: "@图1 的灯塔" },
  );
  const c = makeNode(
    "image",
    { x: 0, y: 310 },
    { title: "operator.jpg", assetId: "operator" },
  );
  const created = await page.request.post(base + "api/projects", {
    data: {
      board: {
        name: "画布验证",
        nodes: [a, b, c],
        edges: [
          { id: "ac", source: a.id, target: b.id },
          { id: "bc", source: c.id, target: b.id },
        ],
        order: [],
      },
    },
  });
  assert.equal(created.status(), 201);
  const board = await created.json(),
    endpoint = base + "api/projects/" + board.id;
  const read = async () => (await page.request.get(endpoint)).json();
  await page.route("**/api/engine", (route) =>
    route.fulfill({
      json: {
        online: true,
        videoModels: [{
          id: "multi-video", name: "多图视频", kind: "video", workflow: true,
          reference: true, needsImage: true, minRefs: 1, maxRefs: 9,
          fields: [], mediaSlots: { image: 9 },
        }],
        imageModels: [
          {
            id: "dynamic",
            name: "测试模型",
            loras: ["AnyAngle", "Qwen-Image-2.1-viggle-turbo-v0.2.1-6step-lora-r256"],
            reference: true,
            maxRefs: 3,
            vae: "a",
            vaes: ["a", "b"],
          },
        ],
      },
    }),
  );
  await page.route("**/nodes/*/jobs", (route) =>
    route.fulfill({
      json: [
        {
          id: "job2",
          assetId: "coast",
          status: "done",
          created: "2026-11-18T04:12:00Z",
        },
        {
          id: "job1",
          assetId: "operator",
          status: "done",
          created: "2026-11-18T04:10:00Z",
        },
      ],
    }),
  );
  const node = (id) => page.locator('.react-flow__node[data-id="' + id + '"]');
  await page.goto(base + "#project/" + board.id + "?node=" + b.id);
  const field = page.getByRole("textbox", { name: "图片节点提示词" });
  await field.waitFor();
  await page.getByRole("button", { name: "风格", exact: true }).click();
  const covers = page.getByRole("button", { name: /^设置封面 / });
  await covers.nth(1).waitFor();
  const [short, long] = await covers.evaluateAll(buttons => buttons.map(button => {
    const rect = button.getBoundingClientRect();
    return { top: rect.top, height: rect.height, titleHeight: button.parentElement.querySelector("strong").offsetHeight };
  }));
  assert.ok(long.titleHeight > short.titleHeight);
  assert.equal(short.height, long.height);
  assert.equal(short.top, long.top);
  await page.getByRole("button", { name: "完成", exact: true }).click();
  const token = field.locator(".picture-token");
  assert.equal(await token.textContent(), "图一");
  assert.equal(await token.locator("img").count(), 1);
  const preview = page.getByRole("dialog", { name: /图一 素材预览/ });
  const originalPrompt = await field.innerText();
  await page.getByRole("button", { name: /^预览 图一 / }).click();
  await preview.waitFor();
  assert.equal(await preview.locator("img").getAttribute("src"), "/stills/coast.jpg");
  await preview.click({ position: { x: 4, y: 12 } });
  await preview.waitFor({ state: "detached" });
  await token.click();
  await preview.waitFor();
  await page.keyboard.press("Escape");
  await preview.waitFor({ state: "detached" });
  assert.equal(await field.innerText(), originalPrompt);
  await field.click();
  await page.keyboard.press("End");
  await page.keyboard.insertText("@");
  const option = page.getByRole("option", { name: "图二" });
  await option.click();
  await field.locator('[data-token="@图2"]').waitFor();
  assert.equal(await field.locator('[data-token="@图2"]').innerText(), "图二");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await field.locator('[data-token="@图2"]').waitFor({ state: "detached" });
  await page.getByRole("button", { name: "插入引用 图二" }).click();
  await field.locator('[data-token="@图2"]').waitFor();
  const ime = await page.context().newCDPSession(page);
  await ime.send("Input.imeSetComposition", {
    text: "眺望",
    selectionStart: 2,
    selectionEnd: 2,
  });
  await ime.send("Input.insertText", { text: "眺望" });
  assert.match(await field.innerText(), /眺望/);
  await ime.detach();
  await page.getByRole("button", { name: "选择图片模型或工作流" }).click();
  const picker = page.getByRole("dialog", { name: "模型与工作流" });
  await picker.getByRole("textbox").fill("测试");
  await picker.getByRole("button", { name: "测试模型" }).click();
  const openSettings = page.getByRole("button", { name: /生成设置/ });
  const settingsBox = await openSettings.boundingBox();
  await openSettings.click();
  const settings = page.getByRole("dialog", { name: "图片生成设置" });
  await settings.getByRole("button", { name: "1920 × 1080", exact: true }).click();
  assert.equal(await settings.getByLabel("宽度").inputValue(), "1920");
  await settings.getByRole("button", { name: /竖屏/ }).click();
  assert.equal(await settings.getByLabel("宽度").inputValue(), "1080");
  assert.equal(await settings.getByRole("button", { name: "1080 × 1920", exact: true }).getAttribute("aria-pressed"), "true");
  await settings.getByRole("button", { name: "完成" }).click();
  await openSettings.click();
  assert.equal(await settings.getByLabel("高度").inputValue(), "1920");
  await settings.getByLabel("宽度").fill("4608");
  await settings.getByRole("alert").filter({ hasText: "4096" }).waitFor();
  assert.ok(await settings.getByRole("button", { name: "完成" }).isDisabled());
  await settings.getByLabel("宽度").fill("1024");
  await settings.getByLabel("高度").fill("1536");
  await settings.getByRole("button", { name: "完成" }).click();
  await openSettings.click();
  assert.equal(await settings.getByLabel("高度").inputValue(), "1536");
  await settings.getByRole("button", { name: /竖屏/ }).click();
  assert.equal(
    await settings
      .getByRole("button", { name: /竖屏/ })
      .getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(await settings.getByText("按提示词中的 @ 引用").count(), 1);
  await settings.getByText("高级设置", { exact: true }).click();
  await settings.getByRole("combobox", { name: "图像解码器（VAE）" }).click();
  await settings.getByRole("option", { name: "b", exact: true }).click();
  await settings.getByRole("button", { name: "完成" }).click();
  const triggerAfter = await openSettings.boundingBox();
  assert.ok(Math.abs(settingsBox.y - triggerAfter.y) < 2);
  await page.getByRole("button", { name: /生成记录/ }).click();
  const history = page.getByRole("dialog", { name: "生成记录" });
  await history.getByRole("button", { name: "对比当前版本" }).click();
  assert.equal(await history.locator("figure img").count(), 2);
  await history.getByRole("button", { name: /历史版本/ }).click();
  assert.ok(
    await history
      .getByRole("button", { name: "当前版本", exact: true })
      .isDisabled(),
  );
  await page.keyboard.press("Escape");
  await history.waitFor({ state: "hidden" });
  assert.equal(
    (await read()).nodes.find((n) => n.id === b.id).data.assetId,
    "operator",
  );
  await page.getByRole("button", { name: /生成记录/ }).click();
  await history.getByRole("button", { name: "使用这个版本" }).click();
  await page.waitForFunction(
    () => document.querySelector(".flow-status")?.textContent === "已保存",
  );
  const saved = (await read()).nodes.find((n) => n.id === b.id).data;
  assert.equal(saved.assetId, "coast");
  assert.equal(saved.canvasRatio, "9:16");
  assert.equal(saved.imageVae, "b");
  assert.match(saved.text, /@图2/u);

  await page.keyboard.press("Escape");
  const A = await node(a.id).boundingBox(),
    B = await node(c.id).boundingBox();
  await page.mouse.move(A.x - 22, A.y - 34);
  await page.mouse.down();
  await page.mouse.move(B.x + 35, B.y + 55, { steps: 15 });
  await page.mouse.up();
  await page.getByText("已选 2 个节点").waitFor();
  await page.keyboard.press("Control+g");
  await page.locator(".canvas-group-frame").waitFor();
  await page.waitForFunction(
    () => document.querySelector(".flow-status")?.textContent === "已保存",
  );
  const grouped = await read();
  assert.equal(
    grouped.nodes[0].data.canvasGroup,
    grouped.nodes[2].data.canvasGroup,
  );
  assert.ok(grouped.nodes[0].data.canvasGroup);
  assert.ok(!grouped.nodes[1].data.canvasGroup);
  await page.reload();
  await page.locator(".canvas-group-frame").waitFor();
  const savedBoard = async () => {
    await page.waitForFunction(
      () => document.querySelector(".flow-status")?.textContent === "已保存",
    );
    return read();
  };
  await page.getByRole("button", { name: "重命名资产组 编组 1" }).click();
  const groupName = page.getByRole("textbox", { name: "资产组名称" });
  await groupName.fill("海岸资产组X");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Enter");
  const grip = page.getByRole("button", { name: "选择资产组 海岸资产组" });
  await grip.waitFor();
  assert.equal(
    (await savedBoard()).nodes[2].data.canvasGroupName,
    "海岸资产组",
  );
  const pos = await grip.boundingBox();
  await page.mouse.move(pos.x + 20, pos.y + pos.height / 2);
  await page.mouse.down();
  await page.mouse.move(pos.x + 80, pos.y + pos.height / 2 + 18, { steps: 15 });
  await page.mouse.up();
  const moved = await savedBoard();
  const dx = (i) => moved.nodes[i].position.x - grouped.nodes[i].position.x;
  assert.ok(dx(0) > 40 && Math.abs(dx(0) - dx(2)) < 1);
  assert.equal(dx(1), 0);
  await node(a.id).locator("img").click();
  const groupPreview = page.getByRole("dialog", { name: "风暴前的灯塔 素材预览" });
  await groupPreview.waitFor();
  assert.equal(await groupPreview.locator("img").getAttribute("src"), "/stills/coast.jpg");
  await groupPreview.getByRole("button", { name: "关闭预览" }).click();
  await field.click();
  await page.keyboard.insertText("灯塔X");
  await page.keyboard.press("Backspace");
  assert.equal((await savedBoard()).nodes[0].data.text, "灯塔");
  await grip.click();
  await field.waitFor({ state: "hidden" });
  const port = page.getByRole("button", { name: "海岸资产组 · 添加下游" });
  const groupSource = "asset-group:" + grouped.nodes[0].data.canvasGroup;
  await port.dragTo(page.getByRole("button", { name: "海岸分镜 · 添加上游" }));
  assert.ok(
    (await savedBoard()).edges.some(
      (e) => e.source === groupSource && e.target === b.id,
    ),
  );
  const start = await port.boundingBox();
  const drop = await page.evaluate(() => {
    for (let x = innerWidth - 80; x > innerWidth / 2; x -= 60) {
      for (let y = innerHeight - 180; y > 140; y -= 60) {
        if (
          document
            .elementFromPoint(x, y)
            ?.classList.contains("react-flow__pane")
        )
          return { x, y };
      }
    }
  });
  assert.ok(drop);
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(drop.x, drop.y, { steps: 12 });
  await page.mouse.up();
  await page.getByText("引用资产组生成", { exact: true }).waitFor();
  await page.getByRole("button", { name: "取消建连" }).click();
  await port.click();
  await page
    .getByRole("group", { name: "节点类型" })
    .getByRole("button", { name: "视频", exact: true })
    .click();
  const videoField = page.getByRole("textbox", { name: "视频节点提示词" });
  const bringEditor = page.getByRole("button", { name: "定位编辑器" });
  if (await bringEditor.isVisible()) {
    await bringEditor.click();
    await page.waitForTimeout(240);
  }
  await videoField.click();
  await page.keyboard.insertText("@");
  await page.getByRole("option", { name: "图二" }).click();
  await videoField.locator('[data-token="@图2"]').waitFor();
  const videoBoard = await savedBoard();
  const videoNode = videoBoard.nodes.find((n) => n.data.kind === "video");
  assert.deepEqual(videoNode.data.imageRefOrder, [a.id, c.id]);
  await openSettings.click();
  const videoSettings = page.getByRole("dialog", { name: "视频生成设置" });
  await videoSettings.getByText("已选 1 / 9 张").waitFor();
  assert.ok(await videoSettings.getByRole("button", { name: /^图二 / }).isDisabled());
  await videoSettings.getByRole("button", { name: /^图一 / }).click();
  await videoSettings.getByText("已选 2 / 9 张").waitFor();
  await videoSettings.getByRole("button", { name: "完成" }).click();
  assert.deepEqual((await savedBoard()).nodes.find(n => n.id === videoNode.id).data.canvasRefIds, [a.id]);
  assert.ok(
    videoBoard.edges.some(
      (e) => e.source === groupSource && e.target === videoNode.id,
    ),
  );
  await page.reload();
  await grip.waitFor();
  await page.getByRole("button", { name: "适合屏幕" }).click();
  await page.waitForTimeout(300);
  await grip.click();
  const videoWire = videoBoard.edges.find((e) => e.target === videoNode.id);
  const wirePoint = await page
    .locator(".react-flow__edge-path")
    .evaluateAll((paths, id) => {
      const path = paths.find((p) => p.id === id);
      for (const fraction of [0.5, 0.25, 0.75]) {
        const point = path
          .getPointAtLength(path.getTotalLength() * fraction)
          .matrixTransform(path.getScreenCTM());
        if (
          document
            .elementFromPoint(point.x, point.y)
            ?.closest(".react-flow__edge") === path.closest(".react-flow__edge")
        )
          return { x: point.x, y: point.y };
      }
    }, videoWire.id);
  assert.ok(wirePoint, "组连线可选中");
  await page.mouse.click(wirePoint.x, wirePoint.y);
  await page.getByRole("button", { name: "断开所选连线" }).waitFor();
  await page.keyboard.press("Delete");
  assert.ok(!(await savedBoard()).edges.some((e) => e.id === videoWire.id));
  await page.keyboard.press("Control+z");
  assert.ok((await savedBoard()).edges.some((e) => e.id === videoWire.id));
  await grip.click();
  await page.keyboard.press("Delete");
  await grip.waitFor({ state: "hidden" });
  const remaining = await savedBoard();
  assert.deepEqual(
    remaining.nodes.map((n) => n.id),
    [b.id, videoNode.id],
  );
  assert.equal(remaining.edges.length, 0);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await grip.waitFor();
  assert.equal((await savedBoard()).edges.length, videoBoard.edges.length);
  await node(videoNode.id).click();
  await page.keyboard.press("Backspace");
  await node(videoNode.id).waitFor({ state: "hidden" });
  assert.equal((await savedBoard()).nodes.length, 3);
  await grip.click();
  await page.keyboard.press("Control+Shift+g");
  await page.locator(".canvas-group-frame").waitFor({ state: "hidden" });
  await page.mouse.click(30, 200);
  await page.keyboard.down("Space");
  await page.locator(".flow-workspace.hand-mode").waitFor();
  const beforePan = await node(a.id).boundingBox();
  await page.mouse.move(30, 200);
  await page.mouse.down();
  await page.mouse.move(75, 235, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up("Space");
  await page.locator(".flow-workspace.select-mode").waitFor();
  const afterPan = await node(a.id).boundingBox();
  assert.ok(afterPan.x - beforePan.x > 30);

  await node(b.id).click();
  await page.getByRole("button", { name: "放大", exact: true }).click();
  await page.getByRole("button", { name: "放大", exact: true }).click();
  await page.waitForTimeout(280);
  const enlarged = await node(b.id).boundingBox(),
    editor = await page.locator(".composer-anchor").boundingBox();
  assert.ok(Math.abs(editor.y - enlarged.y - enlarged.height - 12) < 2);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  const bring = page.getByRole("button", { name: "定位编辑器" });
  if (await bring.isVisible()) {
    await bring.click();
    await page.waitForTimeout(300);
  }
  await openSettings.click();
  const mobile = await settings.boundingBox();
  assert.ok(
    mobile.x >= 0 &&
      mobile.x + mobile.width <= 391 &&
      mobile.y + mobile.height <= 845,
  );
  await settings.getByRole("button", { name: "完成" }).click();
  assert.deepEqual(errors, []);
});

test("参考类型分别编号，断线保留原编号，视频首帧与提示词的引用一致", async () => {
  const { canvasMediaRefs, refLabel, refToken } =
    await import("../../src/canvasReferences.js");
  const {
    canvasInputs,
    resolveImages,
    resolveVideoInputs,
    mediaReferenceError,
  } = await import("../../shared/canvas.js");
  const sources = ["image", "video", "audio", "audio", "image"].map((kind, i) =>
    makeNode(kind, { x: 0, y: i * 200 }, { assetId: "a" + i }),
  );
  const assets = sources.map((n) => ({
    id: n.data.assetId,
    kind: n.data.kind,
    url: "/" + n.data.assetId,
    name: "素材",
  }));
  const target = makeNode("video", { x: 400, y: 0 }, { text: "画面使用 @图2" });
  const board = {
    nodes: [...sources, target],
    edges: sources.map((n, i) => ({
      id: "e" + i,
      source: n.id,
      target: target.id,
    })),
    series: {},
  };
  const inputs = () => canvasInputs(board, target, assets);
  const resolve = () =>
    canvasMediaRefs(
      resolveImages(inputs(), target, assets, { maxRefs: 2 }),
      inputs(),
      target.data,
      assets,
    );
  const initial = resolve();
  const directEdges = board.edges;
  for (const n of sources) n.data.canvasGroup = "混合资产";
  board.edges = [
    { id: "group-wire", source: "asset-group:混合资产", target: target.id },
    directEdges[0],
  ];
  assert.deepEqual(resolve().refs.map(refToken), initial.refs.map(refToken));
  assert.equal(
    resolveVideoInputs(inputs(), target, assets, { needsImage: true })
      .selected[0].id,
    sources[4].id,
  );
  board.edges = directEdges;
  assert.deepEqual(
    initial.refs.map((r) => refLabel(r.asset.kind, r.number)),
    ["图一", "图二", "视频一", "语音一", "语音二"],
  );
  assert.deepEqual(initial.refs.map(refToken), [
    "@图1",
    "@图2",
    "@视频1",
    "@语音1",
    "@语音2",
  ]);
  assert.deepEqual(
    resolveVideoInputs(inputs(), target, assets, {
      needsImage: true,
    }).selected.map((r) => r.assetId),
    ["a4"],
  );
  assert.ok(
    resolveVideoInputs(inputs(), target, assets, { needsImage: false }).error,
  );
  target.data.mediaRefOrder = initial.orders;
  target.data.imageRefOrder = initial.sourceIds;
  board.edges = board.edges.filter(
    (e) => e.source !== sources[2].id && e.source !== sources[4].id,
  );
  assert.deepEqual(resolve().refs.map(refToken), ["@图1", "@视频1", "@语音2"]);
  assert.ok(
    resolveVideoInputs(inputs(), target, assets, { needsImage: true }).error,
  );
  assert.match(mediaReferenceError("旁白使用 @语音2"), /语音/);
});

test("环境下拉框在弹窗内支持触控和键盘切换", async (t) => {
  process.env.STUDIO_DATA_DIR = await mkdtemp(
    path.join(tmpdir(), "canvas-menu-"),
  );
  const dir = process.env.STUDIO_DATA_DIR;
  t.after(() => rm(dir, { recursive: true, force: true }));
  const vite = await createServer({
    server: { port: 0, hmr: false },
    logLevel: "error",
  });
  await vite.listen();
  t.after(() => vite.close());
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ hasTouch: true });
  await page.goto(vite.resolvedUrls.local[0]);
  await page.getByRole("button", { name: "ComfyUI 环境" }).click();
  const menu = page.getByRole("combobox", { name: "已保存的环境" });
  await menu.tap();
  assert.equal(await page.locator("select").count(), 0);
  await page.getByRole("option", { name: "添加新环境…" }).tap();
  assert.equal(await page.getByLabel("服务地址").inputValue(), "");
  await menu.press("Enter");
  await menu.press("Escape");
  assert.equal(await page.getByRole("dialog").count(), 1);
  await menu.press("Enter");
  await menu.press("Home");
  await menu.press("Enter");
  assert.match(await page.getByLabel("服务地址").inputValue(), /^https?:/);
});

test("旁白只朗读直接相连的台词和本节点文本", async () => {
  const { canvasInputs, resolveWorkflowInputs, settleCanvasJobs } =
    await import("../../shared/canvas.js");
  const pos = { x: 0, y: 0 };
  const line = makeNode("text", pos, { title: "台词", text: "雨停了。" });
  const shot = makeNode("shot", pos, { title: "镜头", text: "镜头向前移动。" });
  const voice = makeNode("audio", pos, {
    text: "灯塔亮了。",
    assetId: "first",
    pendingMediaSource: "first",
    pendingCanvasJob: "job",
  });
  const board = {
    nodes: [line, shot, voice],
    edges: [line, shot].map((n) => ({ source: n.id, target: voice.id })),
    series: { style: "水彩" },
  };
  const media = resolveWorkflowInputs(
    canvasInputs(board, voice, []),
    voice,
    [],
    { verbatim: true, mediaSlots: {} },
  );
  assert.equal(media.prompt, "雨停了。\n灯塔亮了。");
  const done = new Map([
    ["job", { nodeId: voice.id, status: "done", assetId: "second" }],
  ]);
  assert.equal(
    settleCanvasJobs(board, done).nodes.at(-1).data.assetId,
    "second",
  );
  voice.data.assetId = "manual";
  assert.equal(
    settleCanvasJobs(board, done).nodes.at(-1).data.assetId,
    "manual",
  );
});
