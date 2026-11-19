import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright";
import { createServer } from "vite";
import { imageFixture } from "../fixtures/browser-image.mjs";

test("中英文长短标题的卡片操作对齐，资产预览与多选独立", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "studio-library-"));
  process.env.STUDIO_DATA_DIR = dir;
  t.after(() => rm(dir, { recursive: true, force: true }));
  const vite = await createServer({ server: { port: 0, hmr: false }, logLevel: "error" });
  await vite.listen();
  t.after(() => vite.close());
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const p = await browser.newPage();
  const base = vite.resolvedUrls.local[0];
  const name = "很长的镜头描述 mixed English 文件名".repeat(4) + ".jpg";
  const photo = await imageFixture(p, "teal", "image/jpeg");
  const uploaded = await p.request.post(base + "api/assets?" + new URLSearchParams({ name }), {
    data: photo, headers: { "content-type": "application/octet-stream" },
  });
  assert.equal(uploaded.status(), 201);
  await p.goto(base + "#assets");
  const card = p.locator(".asset-grid article").first();
  await card.getByRole("button", { name: "预览 " + name }).waitFor();
  for (const width of [1512, 768, 390]) {
    await p.setViewportSize({ width, height: 760 });
    const rows = await p.locator(".asset-grid article").evaluateAll(cards => cards.map(c => ({
      action: c.querySelector(".asset-actions a").getBoundingClientRect().bottom - c.getBoundingClientRect().top,
      height: c.getBoundingClientRect().height,
    })));
    assert.ok(rows.length > 2);
    assert.ok(Math.max(...rows.map(r => r.action)) - Math.min(...rows.map(r => r.action)) <= 1);
    assert.ok(Math.max(...rows.map(r => r.height)) - Math.min(...rows.map(r => r.height)) <= 1);
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await card.getByRole("button", { name: "预览 " + name }).click();
  const viewer = p.getByRole("dialog", { name: name + " 素材预览" });
  await viewer.waitFor();
  await p.keyboard.press("Escape");
  await viewer.waitFor({ state: "detached" });
  await p.setViewportSize({ width: 1200, height: 800 });
  const project = await (await p.request.post(base + "api/projects", { data: {name:"素材选择"} })).json();
  await p.goto(base + "#project/" + project.id);
  await p.getByRole("button", { name: "素材库", exact: true }).click();
  const check = p.getByRole("checkbox", { name: "选择 " + name });
  await check.check();
  await p.getByRole("button", { name: "预览 " + name, exact: true }).click();
  await viewer.getByRole("button", { name: "关闭预览" }).click();
  assert.ok(await check.isChecked());
});
