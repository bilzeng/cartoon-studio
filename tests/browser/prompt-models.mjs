import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import { chromium } from "playwright";
import { createServer } from "vite";

test("填写密钥自动发现模型，保存前测试，切换模型后不沿用旧测试结果", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "studio-model-dialog-"));
  process.env.STUDIO_DATA_DIR = dir;
  t.after(() => rm(dir, { recursive: true, force: true }));
  const provider = express();
  provider.use(express.json());
  let lists = 0;
  const completions = [];
  provider.get("/models", (req, res) => {
    lists++;
    if (req.headers.authorization !== "Bearer test-key")
      return res.sendStatus(401);
    res.json({ data: [{ id: "studio-large" }, { id: "studio-small" }] });
  });
  provider.post("/chat/completions", (req, res) => {
    completions.push(req.body.model);
    if (req.body.model === "studio-large") return res.sendStatus(403);
    res.json({ choices: [{ message: { content: "OK" } }] });
  });
  const mock = provider.listen(0, "127.0.0.1");
  await new Promise((resolve) => mock.once("listening", resolve));
  t.after(() => new Promise((resolve) => mock.close(resolve)));
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
    viewport: { width: 1440, height: 900 },
  });
  page.setDefaultTimeout(7000);
  const button = (name) => page.getByRole("button", { name, exact: true });
  const select = page.getByRole("combobox", { name: "模型 ID", exact: true });
  await page.goto(base);
  await button("提示词模型").click();
  await button("添加模型").click();
  assert.equal(await button("保存模型").isDisabled(), true);
  await page
    .getByLabel("API 基础地址")
    .fill("http://127.0.0.1:" + mock.address().port);
  await page.getByLabel("API Key").fill("test-key");
  await select.waitFor();
  assert.equal(lists, 1);
  assert.equal(await button("测试模型").isEnabled(), false);
  await select.click();
  await page.getByRole("option", { name: "studio-small" }).click();
  await button("测试模型").click();
  await page.getByText(/studio-small 已回复/).waitFor();
  const save = button("保存模型");
  for (const [width, height] of [[1512, 754], [1280, 580], [390, 600], [844, 390]]) {
    await page.setViewportSize({ width, height });
    const fields = page.locator(".opt-fields");
    let footerY;
    for (const end of [false, true]) {
      await fields.evaluate((el, end) => { el.scrollTop = end ? el.scrollHeight : 0; }, end);
      const hit = await save.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return {
          y: r.top,
          visible: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth,
          clickable: el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)),
        };
      });
      assert.ok(hit.visible && hit.clickable, `保存按钮在 ${width}×${height} 应可直接点击`);
      if (end) assert.equal(hit.y, footerY);
      footerY = hit.y;
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  assert.deepEqual(completions, ["studio-small"]);
  assert.deepEqual(
    await (await page.request.get(base + "api/prompt-models")).json(),
    [],
  );
  await select.click();
  await page.getByRole("option", { name: "studio-large" }).click();
  assert.equal(await page.getByText(/studio-small 已回复/).isVisible(), false);
  await button("测试模型").click();
  await page.getByRole("alert").filter({ hasText: "403" }).waitFor();
  await button("手动填写").click();
  await page.getByRole("textbox", { name: "模型 ID" }).fill("custom-alias");
  await button("保存模型").click();
  await page.getByRole("status").filter({ hasText: "DeepSeek 已保存" }).waitFor();
  const profile = button(/DeepSeek.*custom-alias/);
  await profile.click();
  await select.waitFor();
  assert.equal(await select.innerText(), "custom-alias");
  await button("测试模型").click();
  await page.getByText(/custom-alias 已回复/).waitFor();
  await page.getByLabel("API Key").fill("bad-key");
  await page.getByRole("alert").filter({ hasText: "401" }).waitFor();
  assert.equal(
    await page.getByRole("textbox", { name: "模型 ID" }).inputValue(),
    "custom-alias",
  );
  assert.deepEqual(completions, [
    "studio-small",
    "studio-large",
    "custom-alias",
  ]);
});
