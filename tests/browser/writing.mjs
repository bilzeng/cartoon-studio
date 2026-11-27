import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";
import { shotPrompt } from "../../shared/storyboard.js";

test("编剧对话离开后续写，手改方案贯穿章节、资产、分镜与画布，重复导入保留制作进度", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "studio-writing-"));
  process.env.STUDIO_DATA_DIR = dir;
  t.after(() => rm(dir, { recursive: true, force: true }));
  const requests = [];
  let release,
    invalid = false;
  const waitForAuthor = new Promise((resolve) => {
    release = resolve;
  });
  const model = express();
  model.use(express.json());
  function shot(title, duration) {
    return {
      title,
      duration,
      visual: "雨中的信箱",
      framing: "特写",
      camera: "固定机位",
      dialogue: "邮差：你听。",
      imagePrompt: "蓝色雨衣，暖灯照亮信箱",
      videoPrompt: "跟随蓝雨衣邮差，将信投进信箱",
      assetIds: ["A1"],
    };
  }
  model.post("/chat/completions", async (req, res) => {
    const [system, message] = req.body.messages;
    const ctx = JSON.parse(message.content);
    requests.push({ system: system.content, ctx });
    const replies = {
      生成三版梗概: {
        ideas: ["雨信", "回声", "重逢"].map((title) => ({
          title,
          hook: "迟到三十年的信",
          summary: "邮差收到了过去寄来的信。",
          appeal: "寄信人是谁？",
        })),
      },
      生成章节大纲: {
        chapters: [
          { title: "第一封", summary: "在信箱中发现线索" },
          { title: "回信", summary: "找到寄件人" },
        ],
      },
      扩写本章: { script: "外景　邮局　雨夜\n邮差把信交给当年的自己。" },
      整理本章资产: {
        assets: [
          {
            type: "character",
            name: "邮差",
            description: "蓝雨衣，旧邮包",
            prompt: "蓝雨衣邮差，灰白背景，全身设定图",
          },
        ],
      },
      生成本章分镜: { shots: [shot("信箱", 4), shot("交信", 5)] },
      改写这一镜: { shot: shot("雨滴落在旧邮戳上", 7) },
    };
    if (ctx.本轮任务 === "生成三版梗概") await waitForAuthor;
    const content =
      ctx.本轮任务 === "讨论想法"
        ? "让收信人先认出笔迹。"
        : invalid
          ? "{}"
          : JSON.stringify(replies[ctx.本轮任务]);
    res.json({ choices: [{ message: { content } }] });
  });
  const mock = model.listen(0, "127.0.0.1");
  await new Promise((resolve) => mock.once("listening", resolve));
  t.after(() => new Promise((resolve) => mock.close(resolve)));
  const vite = await createServer({ server: { port: 0, hmr: false }, logLevel: "error" });
  await vite.listen();
  t.after(() => vite.close());
  const base = vite.resolvedUrls.local[0];
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(9000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const button = (name) => page.getByRole("button", { name, exact: true });
  await page.request.post(base + "api/prompt-models", {
    data: {
      name: "本地编剧测试",
      model: "writer",
      protocol: "chat",
      baseUrl: "http://127.0.0.1:" + mock.address().port,
    },
  });
  await page.goto(base + "#home");
  await button("剧本创作").first().click();
  await page.setViewportSize({ width: 390, height: 800 });
  await button("更换编剧，当前为逆袭打脸").click();
  assert.ok(await button("逆袭打脸").evaluate((el) => el === document.activeElement));
  await button("悬疑推理").click();
  assert.equal(await button("悬疑推理").getAttribute("aria-pressed"), "true");
  await button("更换编剧，当前为悬疑推理").waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByLabel("剧本名称").fill("邮局");
  await page.getByLabel("章节数").fill("2");
  await page.getByLabel("每章秒数").fill("10");
  await page.getByLabel("故事创意").fill("一封迟到了三十年的信");
  await button("发送创意，生成梗概").click();
  await page.waitForURL("**/#writing/*");
  const draftUrl = page.url(),
    endpoint = base + "api/writing/" + draftUrl.split("/").pop();
  const snapshot = async () => (await page.request.get(endpoint)).json();
  await button("首页").click();
  await page.goto(draftUrl);
  await page.getByText("生成三版梗概中…").waitFor();
  release();
  await page.getByRole("heading", { name: "雨信" }).waitFor();
  assert.match(requests[0].system, /误读的线索/);
  const correction = "寄信的是妹妹。她在找多年没回家的哥哥。";
  await page.getByLabel("和编剧聊聊").fill(correction);
  await button("按当前设定再写三版").click();
  await page.getByText("更早的方案（3）").waitFor();
  assert.equal(requests.at(-1).ctx.作者要求, correction);
  assert.equal(requests.at(-1).ctx.供讨论或点名参考的备选, undefined);
  await page.reload();
  await page.locator("summary").filter({ hasText: "故事设定" }).click();
  await page.locator(".wr-memory-body li").filter({ hasText: correction }).waitFor();
  await button("整理设定").click();
  await page.getByLabel("后续创作采用的设定").fill("妹妹寄出一封迟到了三十年的信，等待哥哥回家。");
  await button("保存修改").click();
  await page.getByText("更早的方案（3）").click();
  await button("编辑梗概 1").click();
  await page.getByRole("dialog").getByLabel("故事梗概").fill("邮差发现信封是自己小时候折的。");
  await button("保存修改").click();
  await page
    .locator("article")
    .filter({ hasText: "自己小时候折的" })
    .getByRole("button", { name: "选用这个梗概" })
    .click();
  await button("生成章节大纲").click();
  await page.getByRole("heading", { name: "第一封" }).waitFor();
  assert.match(requests.at(-1).ctx.选定梗概.summary, /小时候折的/);
  assert.match(requests.at(-1).ctx.作者设定, /等待哥哥回家/);
  await button("去扩写本章").first().click();
  await page.getByLabel("和编剧聊聊").fill("怎么表现邮差的犹豫？");
  await button("只讨论").click();
  await page.getByText("让收信人先认出笔迹。").waitFor();
  await button("扩写本章").click();
  await button("编辑章节剧本").waitFor();
  assert.ok(requests.at(-1).ctx.最近对话.some((m) => m.text.includes("笔迹")));
  await button("编辑章节剧本").click();
  await page.getByLabel("章节正文").fill("外景 邮局 雨夜\n邮差摸着旧邮戳。");
  await button("保存修改").click();
  await button("进入资产设定").click();
  await button("整理本章资产").click();
  await page.getByRole("heading", { name: "邮差" }).waitFor();
  assert.match(requests.at(-1).ctx.当前章.正文, /旧邮戳/);
  await button("进入分镜表").click();
  await button("生成本章分镜").click();
  await page.getByRole("heading", { name: "信箱" }).waitFor();
  await button("跟编剧改这镜").first().click();
  await page.getByLabel("单镜修改要求").fill("让邮戳成为特写");
  await button("改写这一镜").click();
  await page.getByRole("heading", { name: "雨滴落在旧邮戳上" }).waitFor();
  const draft = await snapshot(),
    chapter = draft.ideas[0].chapters[0];
  assert.deepEqual(
    chapter.shots.map((s) => s.duration),
    [4, 6],
  );
  assert.equal(draft.ideas[0].chapters[1].script, "");
  const profileId = (await (await page.request.get(base + "api/prompt-models")).json())[0].id;
  invalid = true;
  await button("重写本章分镜").click();
  await page.getByRole("alert").filter({ hasText: "原稿已保留" }).waitFor();
  assert.deepEqual((await snapshot()).ideas[0].chapters[0].shots, chapter.shots);
  invalid = false;
  await button("导入本章到画布").click();
  await page.waitForURL("**/#project/*");
  const projectId = page.url().split("/").pop();
  const board = await (await page.request.get(base + "api/projects/" + projectId)).json();
  assert.equal(board.order.length, 2);
  assert.equal(board.referenceCards[0].name, "邮差");
  const first = board.nodes.find((n) => n.id === board.order[0]);
  assert.equal(first.data.title, "雨滴落在旧邮戳上");
  assert.equal(first.data.referenceIds[0], board.referenceCards[0].id);
  assert.match(shotPrompt(board, first.data, "video"), /跟随蓝雨衣/);
  const asset = board.nodes.find((n) => n.data.title === "角色 · 邮差");
  assert.equal(asset.data.text, chapter.assets[0].prompt);
  assert.equal(board.edges.filter((e) => e.source === asset.id).length, 2);
  const boardUrl = base + "api/projects/" + projectId;
  const update = await page.request.put(boardUrl, { data: { ...board, name: "正在制作的邮局" } });
  assert.equal(update.status(), 200);
  await page.goto(draftUrl);
  await button("导入本章到画布").click();
  await page.waitForURL("**/#project/" + projectId);
  assert.equal((await (await page.request.get(boardUrl)).json()).name, "正在制作的邮局");
  const latest = await snapshot();
  const stale = await page.request.patch(endpoint, {
    data: { action: "select", id: draft.ideas[1].id, revision: latest.revision - 1 },
  });
  assert.equal(stale.status(), 409);
  const invalidStep = await page.request.post(endpoint + "/generate", {
    data: { action: "shots", revision: latest.revision, profileId, chapterId: draft.ideas[0].chapters[1].id },
  });
  assert.equal(invalidStep.status(), 400);
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(draftUrl);
  await button("导入本章到画布").waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(errors, []);
});
