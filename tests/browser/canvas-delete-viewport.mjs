import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";
import { makeBoard, makeNode } from "../../shared/studio.js";

test("删除、撤销和确认删除保持相机位置，画布手势不会放大页面控件", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "canvas-delete-"));
  process.env.STUDIO_DATA_DIR = dir;
  t.after(() => rm(dir, { recursive: true, force: true }));
  const server = await createServer({
    server: { port: 0, hmr: false },
    logLevel: "error",
  });
  await server.listen();
  t.after(() => server.close());
  const base = server.resolvedUrls.local[0];
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    hasTouch: true,
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/engine", (r) =>
    r.fulfill({ json: { online: false } }),
  );
  const source = makeNode(
    "image",
    { x: -460, y: -122 },
    { title: "灯塔", assetId: "coast" },
  );
  const target = makeNode(
    "image",
    { x: 0, y: 0 },
    { title: "海岸分镜", assetId: "operator" },
  );
  const result = await page.request.post(base + "api/projects", {
    data: {
      board: {
        name: "删除与缩放",
        nodes: [source, target],
        edges: [{ id: "wire", source: source.id, target: target.id }],
        order: [],
      },
    },
  });
  assert.equal(result.status(), 201);
  const board = await result.json();
  await page.goto(base + "#project/" + board.id + "?node=" + target.id);
  const composer = page.locator(".composer-anchor");
  await composer.getByRole("textbox").waitFor();
  const camera = () =>
    page.locator(".react-flow__viewport").evaluate((el) => el.style.transform);
  const windowState = () =>
    page.evaluate(() => ({
      scale: visualViewport.scale,
      x: visualViewport.offsetLeft,
      y: visualViewport.offsetTop,
      scroll: [
        document.querySelector(".flow-workspace").scrollLeft,
        document.querySelector(".flow-workspace").scrollTop,
      ],
    }));
  const normal = { scale: 1, x: 0, y: 0, scroll: [0, 0] };
  const cdp = await page.context().newCDPSession(page);
  const pinch = async (x, y, gestureSourceType = "mouse") => {
    await cdp.send("Input.synthesizePinchGesture", {
      x,
      y,
      scaleFactor: 1.35,
      relativeSpeed: 500,
      gestureSourceType,
    });
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
  };
  const pinchOn = async (control, kind) => {
    const box = await control.boundingBox();
    await pinch(box.x + box.width / 2, box.y + box.height / 2, kind);
  };
  const initial = await camera();
  await pinch(140, 180);
  const zoomed = await camera();
  assert.notEqual(zoomed, initial, "空白处捏合应缩放画布");
  assert.deepEqual(await windowState(), normal);
  const locate = page.getByRole("button", { name: "定位编辑器" });
  if (await locate.isVisible()) {
    await locate.click();
    await page.waitForTimeout(250);
  }
  const before = await camera();
  const more = composer.getByRole("button", { name: "节点操作" });
  await pinchOn(more);
  assert.deepEqual(await windowState(), normal, "编辑面板上的捏合不能放大整页");
  await pinchOn(page.getByRole("button", { name: "画布快捷键" }));
  await pinchOn(composer.getByRole("textbox"), "touch");
  assert.deepEqual(await windowState(), normal);
  assert.equal(await camera(), before);

  const tile = page.locator('.react-flow__node[data-id="' + target.id + '"]');
  await tile.click();
  await page.keyboard.press("Backspace");
  await tile.waitFor({ state: "detached" });
  assert.equal(await camera(), before);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await tile.waitFor();
  assert.equal(await camera(), before);
  await tile.click();
  await more.click();
  await composer.getByRole("button", { name: "删除节点", exact: true }).click();
  const confirm = page.getByRole("button", { name: "确认删除节点" });
  await pinchOn(confirm);
  assert.deepEqual(
    await windowState(),
    normal,
    "删除确认框上的手势不能放大整页",
  );
  await confirm.click();
  await tile.waitFor({ state: "detached" });
  assert.equal(await camera(), before);
  assert.deepEqual(await windowState(), normal);

  // A shot tile can remain mounted for a render after the board was cleared.
  const fixture = makeBoard("tide", "全选删除分镜");
  const copy = await page.request.post(base + "api/projects", {
    data: { board: fixture },
  });
  assert.equal(copy.status(), 201);
  const project = await copy.json();
  const endpoint = base + "api/projects/" + project.id;
  const read = async () => (await page.request.get(endpoint)).json();
  await page.goto(base + "#project/" + project.id);
  await page.locator(".react-flow__node img").first().waitFor();
  const initialCamera = await camera();
  const empty = page.getByText("拖入图片，或双击画布添加创作节点");
  const waitSaved = () =>
    page.locator(".flow-status").getByText("已保存", { exact: true }).waitFor();
  for (const [mod, key] of [
    ["Meta", "Backspace"],
    ["Control", "Delete"],
  ]) {
    await page.keyboard.press(mod + "+a");
    await page.getByText("已选 " + project.nodes.length + " 个节点").waitFor();
    await page.keyboard.press(key);
    await empty.waitFor({ timeout: 3500 }).catch((e) => {
      throw Error(errors.join("\n") || e.message);
    });
    await waitSaved();
    const cleared = await read();
    assert.deepEqual(
      [cleared.nodes, cleared.edges, cleared.order],
      [[], [], []],
    );
    assert.equal(await camera(), initialCamera);
    if (mod === "Meta") {
      await page.keyboard.press(mod + "+z");
      await page.locator(".react-flow__node img").first().waitFor();
      await waitSaved();
      const restored = await read();
      for (const field of ["nodes", "edges", "order"])
        assert.deepEqual(restored[field], project[field]);
    }
  }
  await page.reload();
  await empty.waitFor();
  await page.getByRole("button", { name: "分镜编排" }).click();
  await page.locator(".react-flow__node").waitFor();
  await waitSaved();
  assert.equal((await read()).order.length, 1);
  // Exercise the actual submit button, project autosave and result poller together.
  const image = makeNode(
    "image",
    { x: 0, y: 0 },
    { text: "海岸", assetId: "coast" },
  );
  const images = await page.request.post(base + "api/projects", {
    data: { board: { name: "节点出图", nodes: [image], edges: [], order: [] } },
  });
  const imageProject = await images.json();
  const imagePath = "**/projects/" + imageProject.id;
  await page.route("**/api/engine", (r) =>
    r.fulfill({
      json: {
        online: true,
        imageModels: [{ id: "fixture", name: "图片模型" }],
      },
    }),
  );
  let job = null;
  await page.route(imagePath + "/generate", (r) =>
    r.fulfill({ status: 202, json: { id: "new-image" } }),
  );
  await page.route(imagePath + "/nodes/*/jobs*", (r) =>
    r.fulfill({ json: job ? [job] : [] }),
  );
  await page.route("**/api/jobs?*ids=*", r => r.fulfill({ json: job ? [job] : [] }));
  await page.goto(base + "#project/" + imageProject.id + "?node=" + image.id);
  const tileFace = page.locator(".flow-tile-face");
  const tileImage = tileFace.locator("img");
  await tileImage.waitFor();
  assert.match(await tileImage.getAttribute("src"), /coast/);
  const generate = page.getByRole("button", { name: "生成图片", exact: true });
  await generate.waitFor();
  job = {
    id: "new-image",
    status: "running",
    phase: "executing",
    estimateSamples: 2,
    estimatedExecutionMs: 90000,
    executionObservedAt: new Date().toISOString(),
    created: new Date(Date.now() - 30000).toISOString(),
  };
  await generate.click();
  const overlay = tileFace.locator(".tile-generation");
  await overlay.waitFor();
  assert.ok(await overlay.isVisible());
  assert.equal(await overlay.innerText(), "");
  const timer = page.locator(".generation-result").getByText(/已用 .*执行预计还需约/);
  await timer.waitFor();
  const firstReading = await timer.textContent();
  await page.waitForFunction(text => document.querySelector(".generation-result .job-timing")?.textContent !== text, firstReading);
  await page.setViewportSize({ width: 390, height: 780 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await overlay.evaluate(
      (el) => getComputedStyle(el, "::before").animationName,
    ),
    "none",
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  assert.equal(
    await overlay.evaluate(
      (el) => getComputedStyle(el, "::before").animationName,
    ),
    "tile-generation-drift",
  );
  job = { ...job, status: "done", assetId: "operator" };
  await tileFace.locator('img[src*="operator"]').waitFor();
  await overlay.waitFor({ state: "detached" });
  await waitSaved();
  await page.reload();
  await tileFace.locator('img[src*="operator"]').waitFor();
  assert.deepEqual(errors, []);
});
