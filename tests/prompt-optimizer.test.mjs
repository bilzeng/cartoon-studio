import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";
import {
  optimizationContext,
  optimizedPromptError,
  effectivePrompt,
  optimizedNodeChanges,
} from "../shared/prompt-optimizer.js";

import { resolveWorkflowInputs } from "../shared/canvas.js";

const scene = "座钟响起，林檎说：“谁在门外？”";
const refs = [{ title: "密室", assetId: "room" }];
const model = { id: "test:h3", family: "h3", fields: [] };
const context = optimizationContext(
  { duration: 8 },
  model,
  { prompt: scene, selected: refs },
  "16:9",
);
const text = [
  "subject_definitions: <Subject 1> is the room in <Picture 1>.",
  "summary: [reference generation] A clock rings in the room.",
  "retention_analysis: <Subject 1> (appears in [Shot 1]): fully_preserved - keep the room layout.",
  "detailed_description: [Shot 1] A clock rings. Lin Qin (S1) says <d>[Chinese] 谁在门外？</d>",
  "overall_soundscape: A clock rings.",
  "non_diegetic_music: N/A",
].join("\n");

test("采用的优化稿跟随本次引用、时长和场景", () => {
  assert.equal(optimizedPromptError(text, context), "");
  const draft = { basis: JSON.stringify(context), text };
  assert.equal(effectivePrompt(context, draft), text);
  for (const change of [
    { duration: 5 },
    { scene: "开场是钟" },
    { modelId: "other" },
    { references: [] },
    { references: [{ ...context.references[0], assetId: "different" }] },
  ]) {
    const next = { ...context, ...change };
    assert.equal(effectivePrompt(next, draft), next.scene);
  }
  assert.match(optimizedPromptError(text + "<Picture 2>", context), /未选用/);
  assert.match(
    optimizedPromptError(text.replace("<Picture 1>", ""), context),
    /遗漏/,
  );
  assert.match(
    optimizedPromptError(text + "\n[Shot 2] At 00:08.000, cut.", context),
    /时长/,
  );
  for (const [count, mode] of [
    [0, "T2VA"],
    [1, "I2VA"],
    [2, "FL2VA"],
  ]) {
    assert.equal(
      optimizationContext(
        {},
        { ...model, framePair: true },
        { selected: [refs[0], refs[0]].slice(0, count) },
        "16:9",
      ).mode,
      mode,
    );
  }
});

test("优化直接写回编辑器，生成时保留素材编号、帧顺序及 H3 的开头格式", () => {
  const assets = [1, 2, 3].map(n => ({ id: "a" + n, kind: "image" }));
  const guides = assets.map(a => ({ id: a.id, data: { title: a.id, assetId: a.id } }));
  const inputs = { guides, upstream: guides, words: ["上游描述"], series: { style: "水彩" } };
  const source = { text: "@图3 的灯塔", kind: "image" };
  const image = { id: "qwen", family: "qwen21", workflow: true, maxRefs: 2 };
  const resolved = (data, model) => resolveWorkflowInputs(inputs, { data }, assets, model);
  const makeContext = (data, model) =>
    optimizationContext(data, model, resolved(data, model), "16:9", { forEditor: true });
  const general = makeContext(source, image);
  assert.equal(general.scene, source.text);
  assert.equal(general.references[0].token, "@图3");
  assert.match(optimizedPromptError("@图30 的灯塔", general), /遗漏/);
  const next = { ...source, ...optimizedNodeChanges(source, general, resolved(source, image), "@图3 的白色灯塔") };
  assert.equal(resolved(next, image).prompt, "画风：水彩\n上游描述\n<image1> 的白色灯塔");

  const video = { ...source, kind: "video", canvasRefIds: ["a2"] };
  const h3 = { id: "h3", family: "h3", kind: "video", maxRefs: 2, mentionPattern: "<Picture {n}>" };
  const before = resolved(video, h3);
  const refContext = makeContext(video, h3);
  const production = text.replace("<Picture 1>", "<Picture 1> with <Picture 2>");
  assert.equal(optimizedPromptError(production, refContext), "");
  const edited = { ...video, ...optimizedNodeChanges(video, refContext, before, production) };
  assert.ok(edited.text.includes("@图3"));
  assert.deepEqual(resolved(edited, h3).media.image, [assets[2], assets[1]]);
  assert.equal(resolved(edited, h3).prompt, production);
  const frames = { ...h3, framePair: true, mentionPattern: "图{n}" };
  const frameContext = makeContext(video, frames);
  assert.equal(frameContext.mode, "FL2VA");
  const alignment = "How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark; Picture 2 (from Shot 1) aligns with the 3.00-second mark.";
  const frameText = alignment + "\nintegrated_multimodal_description: [Shot 1] Fade.\noverall_soundscape: N/A\nnon_diegetic_music: N/A";
  assert.equal(optimizedPromptError(frameText, frameContext), "");
  const framed = { ...video, ...optimizedNodeChanges(video, frameContext, resolved(video, frames), frameText) };
  assert.deepEqual(resolved(framed, frames).media.image, [assets[2], assets[1]]);
  assert.equal(resolved(framed, frames).prompt, frameText);
});

test("模型配置隔离密钥，四种协议传送正确的场景、角色和参考编号", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "studio-optimizer-"));
  process.env.STUDIO_DATA_DIR = dir;
  t.after(() => rm(dir, { force: true, recursive: true }));
  async function listen(app) {
    const server = app.listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    t.after(() => new Promise((r) => server.close(r)));
    return "http://127.0.0.1:" + server.address().port;
  }
  const mock = express();
  mock.use(express.json());
  let request;
  mock.get("/v1/models", (req, res) => {
    request = { headers: req.headers };
    if (req.headers.authorization === "Bearer denied")
      return res.sendStatus(401);
    if (req.headers["x-goog-api-key"]) {
      return res.json(
        req.query.pageToken === "p2"
          ? {
              models: [
                {
                  name: "models/test",
                  displayName: "Test",
                  supportedGenerationMethods: ["generateContent"],
                },
              ],
            }
          : {
              nextPageToken: "p2",
              models: [
                {
                  name: "models/embed",
                  supportedGenerationMethods: ["embedContent"],
                },
              ],
            },
      );
    }
    if (req.headers["anthropic-version"])
      return res.json(
        req.query.after_id === "first"
          ? {
              data: [{ id: "test", display_name: "Test" }],
              has_more: false,
            }
          : { data: [{ id: "first" }], has_more: true, last_id: "first" },
      );
    return res.json({
      data: [
        { id: "test" },
        { id: "test" },
        { id: "embedding", output_modalities: ["embedding"] },
      ],
    });
  });
  mock.get("/empty/models", (_req, res) => res.json({ data: [] }));
  mock.get("/missing/models", (_req, res) => res.sendStatus(404));
  mock.get("/other/models", (req, res) => {
    request = { headers: req.headers };
    res.json({ data: [] });
  });
  mock.post("/{*route}", (req, res) => {
    request = { route: req.path, body: req.body, headers: req.headers };
    if (req.body.model === "unauthorized")
      return res.status(401).json({ detail: "secret-value" });
    if (req.path.endsWith("/responses"))
      return res.json({
        status: "completed",
        output: [{ content: [{ type: "output_text", text }] }],
      });
    if (req.path.endsWith("/messages"))
      return res.json({ content: [{ type: "text", text }] });
    if (req.path.endsWith(":generateContent"))
      return res.json({
        candidates: [
          {
            finishReason: "STOP",
            content: { parts: [{ thought: true, text: "scratch" }, { text }] },
          },
        ],
      });
    res.json({
      choices: [{ finish_reason: "stop", message: { content: text } }],
    });
  });
  const baseUrl = (await listen(mock)) + "/v1";
  const { studioApi } = await import("../server/api.mjs");
  const base = await listen(studioApi());
  async function api(route, method = "GET", body) {
    const res = await fetch(base + "/api" + route, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: res.status, data: await res.json() };
  }
  for (const [protocol, route, auth] of [
    ["chat", "/chat/completions", "authorization"],
    ["responses", "/responses", "authorization"],
    ["anthropic", "/messages", "x-api-key"],
    ["gemini", "/models/test:generateContent", "x-goog-api-key"],
  ]) {
    const connection = { protocol, baseUrl, key: "secret-value" };
    const discovered = await api("/prompt-models/discover", "POST", connection);
    assert.equal(discovered.status, 200);
    assert.deepEqual(
      discovered.data.models.map((m) => m.id),
      protocol === "anthropic" ? ["first", "test"] : ["test"],
    );
    assert.match(request.headers[auth], /secret-value$/);
    const probe = await api("/prompt-models/test", "POST", {
      ...connection,
      model: "test",
    });
    assert.equal(probe.status, 200);
    assert.ok(probe.data.elapsedMs >= 0);
    assert.equal(probe.data.model, "test");
    assert.equal(request.route, "/v1" + route);
    assert.match(JSON.stringify(request.body), /Reply with OK/);
    assert.ok(!JSON.stringify(request.body).includes("subject_definitions"));
    assert.deepEqual((await api("/prompt-models")).data, []);
    const profile = (
      await api("/prompt-models", "POST", {
        name: protocol,
        model: "test",
        baseUrl,
        protocol,
        key: "secret-value",
      })
    ).data;
    assert.equal(profile.hasKey, true);
    assert.ok(!JSON.stringify(profile).includes("secret-value"));
    const run = await api("/prompt-optimizer/run", "POST", {
      profileId: profile.id,
      context,
    });
    assert.deepEqual(run, { status: 200, data: { modelName: protocol, text } });
    assert.equal(request.route, "/v1" + route);
    assert.match(request.headers[auth], /secret-value$/);
    const body = JSON.stringify(request.body);
    assert.ok(
      body.includes("Ref2VA") &&
        body.includes("retention_analysis") &&
        body.includes(scene),
    );
    assert.ok(
      body.includes("<Picture 1>") &&
        body.includes("密室") &&
        !body.includes("assetId"),
    );
    assert.equal(
      (await api("/prompt-models/test", "POST", profile)).status,
      200,
    );
    assert.match(request.headers[auth], /secret-value$/);
    const other = baseUrl.replace(/v1$/, "other");
    await api("/prompt-models/discover", "POST", {
      ...profile,
      baseUrl: other,
    });
    assert.equal(request.headers[auth], undefined);
    if (protocol === "chat") {
      for (const [kind, role] of [["image", "美术指导"], ["video", "摄影导演"], ["audio", "声音设计师"]]) {
        const general = optimizationContext({ kind }, { id: kind, family: "qwen21" }, { prompt: scene, selected: refs }, "16:9");
        const run = await api("/prompt-optimizer/run", "POST", { profileId: profile.id, context: general });
        assert.equal(run.status, 200);
        const [instructions, input] = request.body.messages;
        assert.ok(instructions.content.includes(role));
        assert.ok(!instructions.content.includes("retention_analysis"));
        const source = JSON.parse(input.content);
        assert.equal(source.scene, scene);
        assert.equal(source.kind, kind);
        assert.equal("aspect" in source, kind !== "audio");
        assert.equal("duration" in source, kind === "video");
        if (kind === "image") {
          assert.equal(source.references[0].label, "<image1>");
          const withRef = { ...general, scene: "<image1> 中的灯塔" };
          assert.match(optimizedPromptError("雾中的灯塔", withRef), /遗漏/);
          assert.equal(optimizedPromptError("<image1> 中的灯塔隐入海雾。", withRef), "");
        }
        if (kind !== "video") {
          assert.equal((await api("/prompt-optimizer/run", "POST", {
            profileId: profile.id, context: { ...general, mode: "Ref2VA" },
          })).status, 400);
        }
      }
      const narration = optimizationContext({ kind: "audio" }, { id: "tts", verbatim: true }, { prompt: "你听见了吗" });
      assert.equal((await api("/prompt-optimizer/run", "POST", { profileId: profile.id, context: narration })).status, 200);
      assert.match(request.body.messages[0].content, /逐字朗读/);
      assert.equal(optimizedPromptError("你听见了吗？", narration), "");
      assert.match(optimizedPromptError("轻声说：你听见了吗？", narration), /保留原词/);
      assert.deepEqual(
        (
          await api("/prompt-models/discover", "POST", {
            protocol,
            baseUrl: baseUrl.replace(/v1$/, "empty"),
          })
        ).data.models,
        [],
      );
      assert.match(
        (
          await api("/prompt-models/discover", "POST", {
            protocol,
            baseUrl: baseUrl.replace(/v1$/, "missing"),
          })
        ).data.error,
        /404/,
      );
      assert.match(
        (
          await api("/prompt-models/discover", "POST", {
            ...profile,
            key: "denied",
          })
        ).data.error,
        /401/,
      );
      assert.match(
        (
          await api("/prompt-models/test", "POST", {
            ...profile,
            model: "unauthorized",
          })
        ).data.error,
        /401/,
      );
    }
    const saved = (
      await api("/prompt-models", "POST", {
        ...profile,
        model: "unauthorized",
        key: "",
      })
    ).data;
    assert.equal(saved.hasKey, true);
    if (protocol === "chat") {
      const failure = await api("/prompt-optimizer/run", "POST", {
        profileId: profile.id,
        context,
      });
      assert.equal(failure.status, 502);
      assert.match(failure.data.error, /401/);
      assert.ok(!failure.data.error.includes("secret-value"));
    }
    const changed = (
      await api("/prompt-models", "POST", {
        ...profile,
        baseUrl: baseUrl + "/other",
      })
    ).data;
    assert.equal(changed.hasKey, false);
    await api("/prompt-models/" + profile.id, "DELETE");
  }
  assert.deepEqual((await api("/prompt-models")).data, []);
});
