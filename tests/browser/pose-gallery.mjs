import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";
import { makeNode } from "../../shared/studio.js";
import { poseSwapModelId } from "../../shared/pose-swap.js";

test("PoseSwap 图库支持翻页和跳页，窄窗口的页脚与卡片标题完整显示", async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "studio-pose-gallery-"));
  process.env.STUDIO_DATA_DIR = dataDir;
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const vite = await createServer({ server: { port: 0, hmr: false }, logLevel: "error" });
  await vite.listen();
  t.after(() => vite.close());
  const base = vite.resolvedUrls.local[0];
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1512, height: 753 } });
  page.setDefaultTimeout(7000);

  const uploaded = await page.request.post(base + "api/assets", {
    multipart: { file: {
      name: "portrait.png", mimeType: "image/png",
      buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jHZkAAAAASUVORK5CYII=", "base64"),
    } },
  });
  assert.equal(uploaded.status(), 201);
  const { id: assetId } = await uploaded.json();
  const node = makeNode("image", { x: 0, y: 0 }, { imageModel: poseSwapModelId, canvasRatio: "16:9", assetId });
  const project = await page.request.post(base + "api/projects", {
    data: { board: { name: "PoseSwap 图库布局", nodes: [node], edges: [], order: [] } },
  });
  assert.equal(project.status(), 201);
  const { id } = await project.json();
  const assets = [{
    id: assetId, name: "竖屏成品", kind: "image", url: "/test-portrait.svg",
  }];
  await page.route("**/api/assets", (route) => route.fulfill({ json: assets }));
  await page.route("**/test-portrait.svg", (route) => route.fulfill({
    contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="432" height="768"><path fill="white" d="M0 0h432v768H0z"/></svg>',
  }));
  await page.route("**/api/engine", (route) => route.fulfill({ json: {
    online: true,
    imageModels: [{
      id: poseSwapModelId, name: "PoseSwap · 姿势与换装", kind: "image",
      workflow: true, hasPrompt: false, controls: [], fields: [], maxRefs: 3, minRefs: 2,
    }],
  } }));
  const longTitle = "奶油色针织开衫 搭配深红色羊毛阔腿裤、长靴及银色手提包";
  const rows = Array.from({ length: 1439 }, (_, index) => ({
    id: "outfit-" + index,
    title: (index % 2 ? "beige knit red pants fur jacket brown leather boots bag" : longTitle) + " " + (index + 1),
    category: "冬装",
    keywords: index === 1438 ? "final-look" : "",
    thumbnail: "/stills/operator.jpg",
  }));
  await page.route("**/api/pose-swap/gallery/outfit", (route) => route.fulfill({ json: rows }));
  await page.goto(base + "#project/" + id + "?node=" + node.id);
  const result = page.getByRole("img", { name: "竖屏成品", exact: true }).and(page.locator(".tile-image"));
  await result.waitFor();
  await page.waitForFunction(() => {
    const card = document.querySelector(".flow-tile-face");
    return card?.clientWidth / card?.clientHeight < 0.59;
  });
  assert.deepEqual(await result.evaluate((img) => {
    const card = img.closest(".flow-tile-face");
    return [img.naturalWidth, img.naturalHeight, img.clientHeight === card.clientHeight,
      img.clientWidth === card.clientWidth, getComputedStyle(img).objectFit];
  }), [432, 768, true, true, "contain"]);
  assert.ok(await page.locator(".flow-tile-face .tile-file-tools").getByRole("link", { name: "下载图片" }).isVisible());
  await page.getByRole("button", { name: "选择服装", exact: true }).click();
  const dialog = page.locator("dialog[open]");
  const cards = dialog.locator(".pose-gallery-card");
  await cards.nth(23).waitFor({ state: "attached" });
  const grid = dialog.locator(".pose-gallery-grid");
  const previous = dialog.getByRole("button", { name: "上一页", exact: true });
  const next = dialog.getByRole("button", { name: "下一页", exact: true });
  assert.ok(await previous.isDisabled());

  async function checkLayout() {
    const layout = await dialog.evaluate((el) => {
      const rect = (target) => target.getBoundingClientRect();
      const frame = rect(el);
      const grid = el.querySelector(".pose-gallery-grid");
      const cards = [...grid.querySelectorAll(".pose-gallery-card")];
      const first = rect(cards[0]);
      const secondRow = cards.map(rect).find((card) => card.top > first.top + 4);
      const title = cards[0].querySelector("b");
      const classification = cards[0].querySelector("small");
      const footerElement = el.querySelector(".pose-gallery-footer");
      const footer = rect(footerElement);
      return {
        footerInside: footer.bottom <= Math.min(frame.bottom, innerHeight) - 5,
        paginationFits: footerElement.scrollWidth <= footerElement.clientWidth,
        gridAboveFooter: rect(grid).bottom <= footer.top - 5,
        gridScrolls: grid.scrollHeight > grid.clientHeight,
        gap: secondRow?.top - first.bottom,
        titleWraps: title.clientHeight > parseFloat(getComputedStyle(title).lineHeight) * 1.5,
        titleFits: title.scrollHeight <= title.clientHeight,
        categoryInside: rect(classification).bottom <= first.bottom - 5,
      };
    });
    assert.deepEqual(
      { ...layout, gap: layout.gap >= 9 },
      { footerInside: true, paginationFits: true, gridAboveFooter: true, gridScrolls: true, gap: true,
        titleWraps: true, titleFits: true, categoryInside: true },
    );
  }
  await checkLayout();
  const pagerY = (await next.boundingBox()).y;
  await grid.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  assert.ok(await grid.evaluate((el) => el.scrollTop > 0));
  assert.equal((await next.boundingBox()).y, pagerY);
  await next.click();
  assert.match(await cards.first().innerText(), /25/);
  assert.equal(await grid.evaluate((el) => el.scrollTop), 0);

  const currentPage = dialog.locator('[aria-current="page"]');
  const jump = dialog.getByRole("textbox", { name: "跳转页码" });
  await grid.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await jump.fill("１８");
  await jump.press("Enter");
  assert.equal(await currentPage.innerText(), "18");
  assert.match(await cards.first().innerText(), /409/);
  assert.equal(await grid.evaluate((el) => el.scrollTop), 0);
  await jump.fill("61");
  await jump.press("Enter");
  assert.equal(await currentPage.innerText(), "18");
  assert.match(await dialog.getByRole("alert").innerText(), /1–60/);

  await page.setViewportSize({ width: 390, height: 640 });
  await checkLayout();
  await jump.fill("60");
  await dialog.getByRole("button", { name: "跳转", exact: true }).click();
  assert.equal(await currentPage.innerText(), "60");
  assert.equal(await cards.count(), 23);
  assert.ok(await next.isDisabled());
  assert.equal(await dialog.getByRole("alert").count(), 0);
  await previous.click();
  assert.equal(await cards.count(), 24);
  assert.equal(await currentPage.innerText(), "59");
  await page.setViewportSize({ width: 320, height: 568 });
  await checkLayout();
  await dialog.getByRole("button", { name: "第 1 页", exact: true }).click();
  assert.equal(await currentPage.innerText(), "1");
  assert.ok(await previous.isDisabled());
  await dialog.getByRole("button", { name: "第 60 页", exact: true }).click();
  assert.equal(await currentPage.innerText(), "60");
  await page.setViewportSize({ width: 390, height: 640 });
  await dialog.getByRole("textbox", { name: "搜索 PoseSwap 图库" }).fill("final-look");
  assert.equal(await cards.count(), 1);
  assert.match(await dialog.locator(".pose-page-count").innerText(), /1–1 \/ 共 1 项/);
  assert.equal(await dialog.getByRole("navigation", { name: "图库分页" }).count(), 0);

  const outfits = [];
  for (const [i, name] of ["operator.jpg", "coast.jpg"].entries()) {
    const bytes = await readFile(new URL("../../public/stills/" + name, import.meta.url));
    const created = await page.request.post(base + "api/assets", {
      multipart: { file: {
        name: "服装 " + (i + 1) + ".jpg", mimeType: "image/jpeg",
        buffer: Buffer.concat([bytes, Buffer.from("pose reference fixture")]),
      } },
    });
    assert.equal(created.status(), 201);
    outfits.push(await created.json());
  }
  await page.route("**/api/pose-swap/gallery/outfit/outfit-*", (route) => {
    const asset = route.request().url().endsWith("outfit-1438") ? outfits[0] : outfits[1];
    if (!assets.some((item) => item.id === asset.id)) assets.push(asset);
    return route.fulfill({ json: asset });
  });
  const endpoint = base + "api/projects/" + id;
  const saved = () => page.waitForResponse((response) =>
    response.url() === endpoint && response.request().method() === "PUT" && response.ok());
  let savedBoard = saved();
  await cards.first().click();
  const before = await (await savedBoard).json();
  await page.setViewportSize({ width: 1512, height: 753 });
  await page.getByRole("button", { name: "更换服装", exact: true }).click();
  await cards.nth(1).waitFor();
  savedBoard = saved();
  await cards.nth(1).click();
  const after = await (await savedBoard).json();
  assert.equal(after.nodes.length, 2);
  assert.deepEqual(after.edges, before.edges);
  assert.deepEqual(after.nodes[0].data.poseSwapRefs, before.nodes[0].data.poseSwapRefs);
  assert.equal(after.nodes[1].id, before.nodes[1].id);
  assert.equal(after.nodes[1].data.assetId, outfits[1].id);
});
