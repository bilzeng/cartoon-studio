import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import { createServer } from "vite";
import { makeNode } from "../../shared/studio.js";

test("拖动时节点与连线持续可见，只保存落点；端口能吸附并保留流光", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "studio-canvas-"));
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
    viewport: { width: 1400, height: 820 },
  });
  await page.route("**/api/engine", (route) =>
    route.fulfill({ json: { online: false } }),
  );
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  const source = makeNode(
    "image",
    { x: 0, y: 0 },
    { title: "灯塔", assetId: "coast" },
  );
  const target = makeNode("text", { x: 650, y: 0 }, { title: "旁白" });
  const third = makeNode("text", { x: 650, y: 300 }, { title: "潮汐" });
  const request = await page.request.post(base + "api/projects", {
    data: {
      board: {
        name: "画布交互测试",
        nodes: [source, target, third],
        edges: [{ id: "existing", source: source.id, target: target.id }],
        order: [],
      },
    },
  });
  assert.equal(request.status(), 201);
  const board = await request.json();
  const projectUrl = base + "api/projects/" + board.id;
  const read = async () => (await page.request.get(projectUrl)).json();
  const url = base + "#project/" + board.id + "?node=" + source.id;
  await page.goto(url);
  const node = page.locator('.react-flow__node[data-id="' + source.id + '"]');
  const edge = page.locator(".react-flow__edge-path").first();
  await edge.waitFor({ state: "visible" });
  await node.locator("img").waitFor({ state: "visible" });
  await page.waitForFunction(
    () => document.querySelector(".react-flow__node img")?.naturalWidth > 0,
  );
  await page.evaluate(() => {
    window.dragSamples = { hidden: 0, missingEdge: 0 };
    window.dragObserver = new MutationObserver((rows) => {
      for (const row of rows) {
        if (
          row.type === "attributes" &&
          row.target.matches(".react-flow__node") &&
          (row.target.style.visibility === "hidden" ||
            row.oldValue?.includes("visibility: hidden"))
        )
          window.dragSamples.hidden++;
        if (row.type === "childList")
          for (const el of row.removedNodes) {
            if (
              el.nodeType === 1 &&
              (el.matches(".react-flow__edge") ||
                el.querySelector(".react-flow__edge-path"))
            )
              window.dragSamples.missingEdge++;
          }
      }
    });
    window.dragObserver.observe(document.querySelector(".react-flow"), {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["style"],
      attributeOldValue: true,
    });
  });
  const p = await node.boundingBox();
  const x = p.x + p.width / 2,
    y = p.y + p.height / 2;
  const writes = [];
  page.on("request", (req) => {
    if (req.method() === "PUT" && req.url() === projectUrl) writes.push(req);
  });
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 50, y + 12, { steps: 14 });
  // Keep holding past the board's autosave debounce.
  await page.waitForTimeout(550);
  const writesWhileHeld = writes.length;
  await page.mouse.move(x + 120, y + 34, { steps: 16 });
  await page.mouse.up();
  const landed = await node.boundingBox();
  const offset = { x: landed.x - p.x, y: landed.y - p.y };
  const samples = await page.evaluate(() => {
    window.dragObserver.disconnect();
    return window.dragSamples;
  });
  t.diagnostic(JSON.stringify({ ...samples, writesWhileHeld, offset }));
  assert.deepEqual(
    { ...samples, writesWhileHeld },
    { hidden: 0, missingEdge: 0, writesWhileHeld: 0 },
  );
  await page.waitForFunction(
    () => document.querySelector(".flow-status")?.textContent === "已保存",
  );
  assert.equal(writes.length, 1);
  assert.ok(
    Math.abs(offset.x - 120) < 6 && Math.abs(offset.y - 34) < 6,
    "拖动落点应在鼠标阈值内",
  );
  const saved = await read();
  const where = saved.nodes.find((n) => n.id === source.id).position;
  assert.ok(where.x > source.position.x && where.y > source.position.y);
  await page.reload();
  await edge.waitFor({ state: "visible" });
  assert.deepEqual(
    (await read()).nodes.find((n) => n.id === source.id).position,
    where,
  );
  const port = page.getByRole("button", { name: "灯塔 · 添加下游" });
  const incoming = page.getByRole("button", { name: "潮汐 · 添加上游" });
  const palette = page.getByRole("group", { name: "节点类型" });
  const center = async (loc) => {
    const b = await loc.boundingBox();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const a = await center(port),
    b = await center(incoming);
  await page.mouse.move(a.x + 6, a.y + 2);
  await page.waitForFunction(
    () =>
      parseFloat(
        document
          .querySelector(".source:hover")
          ?.style.getPropertyValue("--pull-x"),
      ) > 0,
  );
  assert.deepEqual(await center(port), a, "吸附反馈不能移动命中区域");
  await port.click();
  await palette.waitFor();
  assert.equal(await page.locator(".composer-anchor").count(),0);
  const light = page.locator(".pending-wire .flow-wire-light");
  const phase = () =>
    light.evaluate((el) => getComputedStyle(el).strokeDashoffset);
  const first = await phase();
  await page.waitForFunction(
    (previous) =>
      getComputedStyle(document.querySelector(".pending-wire .flow-wire-light"))
        .strokeDashoffset !== previous,
    first,
  );
  await page.keyboard.press("Escape");
  await palette.waitFor({ state: "hidden" });

  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  // Release outside both the visible cap and its hit area, inside the snap radius.
  await page.mouse.move(b.x - 22, b.y, { steps: 20 });
  await page.locator(".flow-port.connectingto.valid").waitFor();
  assert.equal(await page.locator(".composer-anchor").count(),0);
  await page
    .locator(".react-flow__connection .flow-wire-light")
    .waitFor({ state: "attached" });
  await page.mouse.up();
  await page.waitForFunction(
    () => document.querySelectorAll(".react-flow__edge-path").length === 2,
  );
  assert.equal(await page.locator(".composer-anchor").count(),0);
  await page.waitForFunction(
    () => document.querySelector(".flow-status")?.textContent === "已保存",
  );
  assert.ok(
    (await read()).edges.some(
      (e) => e.source === source.id && e.target === third.id,
    ),
  );

  await page.emulateMedia({ reducedMotion: "reduce" });
  await port.focus();
  await page.keyboard.press("Enter");
  await palette.waitFor();
  assert.equal(
    await light.evaluate((el) => getComputedStyle(el).animationName),
    "wire-travel",
  );
  const counts = (await read()).edges.length;
  await page.keyboard.press("Escape");
  await palette.waitFor({ state: "hidden" });
  assert.equal((await read()).edges.length, counts);

  const mobile = await browser.newPage({
    hasTouch: true,
    viewport: { width: 390, height: 844 },
  });
  await mobile.route("**/api/engine", (route) =>
    route.fulfill({ json: { online: false } }),
  );
  await mobile.goto(base + "#project/" + board.id);
  await mobile.getByRole("button", { name: "灯塔 · 添加下游" }).tap();
  const mobilePalette = mobile.getByRole("group", { name: "节点类型" });
  await mobilePalette.waitFor();
  const menuBox = await mobilePalette.boundingBox();
  assert.ok(
    menuBox.x >= 0 &&
      menuBox.x + menuBox.width <= 390 &&
      menuBox.y + menuBox.height <= 844,
  );
  const mobilePort = await center(
    mobile.getByRole("button", { name: "灯塔 · 添加下游" }),
  );
  assert.ok(
    mobilePort.x < menuBox.x ||
      mobilePort.x > menuBox.x + menuBox.width ||
      mobilePort.y < menuBox.y ||
      mobilePort.y > menuBox.y + menuBox.height,
    "菜单应避开已吸附的端口",
  );
  await mobile.getByRole("button", { name: "取消建连" }).tap();
  await mobilePalette.waitFor({ state: "hidden" });
  assert.deepEqual(errors, []);
});
