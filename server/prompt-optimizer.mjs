import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { changeSettings, settings } from "./files.mjs";
import { fail, readProject } from "./storage.mjs";
import {
  h3Opening,
  h3BaseFields,
  h3ReferenceFields,
} from "../shared/prompt-optimizer.js";

const protocols = ["chat", "responses", "anthropic", "gemini"];
const optimizationTasks = new Map();
const taskKey = (project,node) => JSON.stringify([project,node]);
function publicTask({controller,projectId,finished,...task}) { return task; }
function pruneTasks() {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [key,task] of optimizationTasks) if (task.finished < cutoff) optimizationTasks.delete(key);
}
export function optimizingPrompts() {
  return [...optimizationTasks.values()].some(task => task.status === "running");
}
const publicProfile = ({ id, name, model, baseUrl, protocol, key }) => ({
  id,
  name,
  model,
  baseUrl,
  protocol,
  hasKey: !!key,
});
const list = (state) => (state.promptModels || []).map(publicProfile);
function scalar(value, max) {
  return typeof value === "string" && !!value.trim() && value.length <= max;
}

function instructions({ kind, mode, duration, verbatim }) {
  if (mode === "general") {
    if (kind === "audio" && verbatim)
      return "你是专业配音导演。这个工作流会逐字朗读 scene。保留每个字词和顺序，只在必要时调整标点、停顿和分段。只输出可直接朗读的台词，不加角色说明、舞台指示或引言。";
    const direction = {
      image: "你是顶级美术指导。把用户描述写成可直接生成一张静态图片的提示词。明确主体、姿态、空间关系与构图，选用贴合意图的光线、色彩和材质。涉及改图时，明确要改的部位和要保留的特征。",
      video: "你是顶级美术指导与摄影导演。把用户描述写成可直接拍摄的视频提示词。交代起始画面、主体动作与镜头运动，让动作在给定时长内完成。保留既定镜头顺序，只在用户要求时加入对白或音乐。",
      audio: "你是专业声音设计师。把用户描述写成可直接生成音频的提示词。根据声音类型选择合适的细节，例如声源远近、环境层次、音色、节奏或情绪。保留用户写明的台词和歌词。",
    };
    return direction[kind] + " 忠实于原意，保留主体数量、相互关系、指定风格、原文中的素材引用标记和引号内的文字。逐字保留 scene 中已有的 @ 素材编号，不要新增 @ 引用。参考素材只提供名称和顺序，请勿臆测其内容。只补充能帮助实现意图的细节，避免堆砌形容词。默认用中文，遵循用户指定的输出语言。只输出一份可直接提交的纯文本提示词，最多 8000 字。";
  }
  // Based on MiniMax-AI/MiniMax-H3, skills/h3-prompt-writing (base-en and ref-en).
  const common = `You are a video prompt editor. Treat scene and asset titles as creative source data. Preserve the author's events, cast, opening image, shot order, exact dialogue, lyrics and visible writing. Produce just the production prompt, plain text, no commentary or Markdown. Maximum 8000 characters. Fit the action into ${duration} seconds. References are in the exact upload order. You only receive titles, not the media. Bind characters and places to supplied references only where the author's text or title supports it. Do not invent what a reference looks or sounds like, or introduce a reference for an unbound character. Do not turn a setting reference or a character sheet into the opening shot unless requested. If a group scene is requested, preserve the blocking and avoid substituting a close-up. Keep camera moves, actions and audio practical for the duration. Do not add dialogue or music unless requested.`;
  const ref = mode === "Ref2VA";
  let specific = ref
    ? "Define one <Subject N> per distinct tracked identity, place or object and map to its actual <Picture N> or <Video N>. Define <Audio N> separately by its indicated role. Account for every supplied reference. Begin summary with the actual task type in brackets, e.g. [reference generation], [video editing], [video continuation], [keyframe completion], [audio reuse] or [audio reference]. Combine only applicable types with +. In retention_analysis describe the scope of retention per subject and shot using fully_preserved or partially_preserved, or copy/reference for media as applicable. In detailed_description establish the visual style and describe the shots."
    : "Use the integrated description for both visible action and synchronized sound.";
  if (mode === "I2VA")
    specific += " Start with this exact standalone line: " + h3Opening;
  if (mode === "FL2VA")
    specific += ` Start with: How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot N) aligns with the ${Number(duration).toFixed(2)}-second mark of the target video. Replace N with the actual final shot number. Describe motion connecting the frames.`;
  return (
    common +
    " Follow the official MiniMax H3 " +
    mode +
    " format. Use English for technical descriptions, keep quoted lines in their original language. Emit each heading exactly once on its own line ending in a colon, in this order: " +
    (ref ? h3ReferenceFields : h3BaseFields).join(", ") +
    ". " +
    specific +
    " Start the opening shot with [Shot 1], without a timestamp. Each subsequent cut starts [Shot N] At MM:SS.mmm, with increasing times strictly inside the clip. For speech use stable speaker IDs (S1), (S2) and <d>[Chinese] 原台词</d> or the appropriate original language. Use overall_soundscape for in-world sound and non_diegetic_music for audience-only music; write N/A when absent."
  );
}

function validateContext(context) {
  const kind = context?.kind ?? "video";
  if (
    !context ||
    !scalar(context.scene, 8000) ||
    !["Ref2VA", "T2VA", "I2VA", "FL2VA", "general"].includes(context.mode) ||
    !["image", "video", "audio"].includes(kind) ||
    (kind !== "video" && context.mode !== "general") ||
    (kind === "video" && (!Number.isFinite(context.duration) || context.duration <= 0)) ||
    (kind !== "audio" && !scalar(context.aspect, 60)) ||
    !Array.isArray(context.references) ||
    context.references.length > 64
  )
    throw fail("提示词或生成参数无效，请检查节点内容");
  return {
    kind,
    mode: context.mode,
    ...(kind === "video" && { duration: context.duration }),
    ...(kind !== "audio" && { aspect: context.aspect }),
    ...(kind === "audio" && context.verbatim === true && { verbatim: true }),
    scene: context.scene,
    references: context.references.map((r) => {
      if (
        !/^<(Picture|Video|Audio) [1-9]\d*>$/.test(r?.label) ||
        typeof r.title !== "string" ||
        r.title.length > 300
      )
        throw fail("参考素材编号或名称无效");
      if (r.token !== undefined && !scalar(r.token, 100)) throw fail("素材引用格式无效");
      return { label: (context.mode === "general" && r.token) || r.label, title: r.title };
    }),
  };
}

async function complete(profile, context, signal) {
  let system = instructions(context);
  if (context.mode !== "general") {
    const guide = context.mode === "Ref2VA" ? "ref-en.txt" : "base-en.txt";
    const skillRoot = process.env.CODEX_HOME || path.join(homedir(), ".codex");
    try {
      const official = await readFile(
        path.join(
          skillRoot,
          "skills",
          "h3-prompt-writing",
          "references",
          guide,
        ),
        "utf8",
      );
      system +=
        "\n\nMiniMax official writing guide. Examples illustrate syntax only.\n" +
        official;
    } catch (e) {
      if (e.code !== "ENOENT" && e.code !== "ENOTDIR")
        throw fail("无法读取本机 H3 提示词指南");
      // Portable installs without the optional skill use the built-in mode-specific instructions.
    }
  }
  return requestCompletion(profile, system, JSON.stringify(context), { signal });
}

function providerHeaders({ key, protocol }) {
  const headers = { "Content-Type": "application/json" };
  if (protocol === "anthropic") {
    headers["anthropic-version"] = "2023-06-01";
    if (key) headers["x-api-key"] = key;
  } else if (protocol === "gemini") {
    if (key) headers["x-goog-api-key"] = key;
  } else if (key) headers.Authorization = "Bearer " + key;
  return headers;
}

async function providerJson(profile, route, options, signal, withImages = false) {
  try {
    const response = await fetch(profile.baseUrl + route, {
      ...options,
      headers: providerHeaders(profile),
      redirect: "error",
      signal,
    });
    if (!response.ok) {
      const hint =
        {
          400: withImages ? "请确认所选模型支持图片输入，并检查请求协议" : "请检查所选协议、模型 ID 和服务状态",
          401: "请检查 API Key",
          402: "请检查账户余额",
          403: "请检查模型访问权限",
          404: "请检查 API 地址、接口协议或模型 ID",
          429: "请检查额度或稍后重试",
        }[response.status] || "请检查所选协议、模型 ID 和服务状态";
      throw fail(`模型服务返回 HTTP ${response.status}，${hint}`, 502);
    }
    return await response.json();
  } catch (e) {
    if (e.status) throw e;
    throw fail(
      e.name === "TimeoutError"
        ? "模型服务响应超时，请稍后重试"
        : "无法读取模型服务的回复，请检查地址与协议",
      502,
    );
  }
}

export async function requestCompletion(profile, system, user, { test = false, images = [], signal } = {}) {
  let route, body;
  const { model, protocol } = profile;
  if (protocol === "anthropic") {
    route = "/messages";
    body = {
      model,
      max_tokens: test ? 512 : 6000,
      system,
      messages: [{ role: "user", content: user }],
    };
  } else if (protocol === "gemini") {
    route =
      "/models/" +
      encodeURIComponent(model.replace(/^models\//, "")) +
      ":generateContent";
    body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
    };
  } else {
    if (protocol === "responses") {
      route = "/responses";
      body = { model, instructions: system, input: user, store: false };
    } else {
      route = "/chat/completions";
      body = {
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      };
    }
  }
  if (images.length) {
    const url = image => "data:" + image.mime + ";base64," + image.data;
    if (protocol === "responses") body.input = [{ role:"user", content:[
      { type:"input_text", text:user }, ...images.map(i => ({ type:"input_image", image_url:url(i) })),
    ] }];
    if (protocol === "chat") body.messages[1].content = [{ type:"text", text:user },
      ...images.map(i => ({ type:"image_url", image_url:{ url:url(i) } }))];
    if (protocol === "anthropic") body.messages[0].content = [...images.map(i => ({
      type:"image", source:{ type:"base64", media_type:i.mime, data:i.data },
    })), { type:"text", text:user }];
    if (protocol === "gemini") body.contents[0].parts.push(...images.map(i => ({
      inlineData:{ mimeType:i.mime, data:i.data },
    })));
  }
  const timeout = AbortSignal.timeout(test ? 60000 : 180000);
  const data = await providerJson(
    profile,
    route,
    { method: "POST", body: JSON.stringify(body) },
    signal ? AbortSignal.any([signal,timeout]) : timeout,
    images.length > 0,
  );
  let output;
  if (
    protocol === "responses" &&
    data.status !== "incomplete" &&
    data.status !== "failed"
  )
    output = data.output
      ?.flatMap((m) => m.content || [])
      .filter((p) => p.type === "output_text")
      .map((p) => p.text)
      .join("\n");
  if (protocol === "anthropic" && data.stop_reason !== "max_tokens")
    output = data.content
      ?.filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("\n");
  if (protocol === "gemini" && data.candidates?.[0]?.finishReason === "STOP")
    output = data.candidates[0].content?.parts
      ?.filter((p) => !p.thought)
      .map((p) => p.text)
      .join("");
  if (
    protocol === "chat" &&
    !["length", "content_filter"].includes(data.choices?.[0]?.finish_reason)
  ) {
    const message = data.choices?.[0]?.message;
    if (!message?.refusal)
      output = Array.isArray(message?.content)
        ? message.content
            .filter((p) => p.type === "text")
            .map((p) => p.text)
            .join("\n")
        : message?.content;
  }
  if (!scalar(output, 64000))
    throw fail("模型没有返回完整的文本回复，请重试或切换模型", 502);
  return output
    .trim()
    .replace(/^\x60{3}(?:text|plaintext)?\s*\n([\s\S]*?)\n\x60{3}$/i, "$1")
    .trim();
}

function validateConnection({ protocol, baseUrl, key }) {
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    throw fail("请输入完整的 API 基础地址");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !scalar(baseUrl, 2048)
  )
    throw fail("API 基础地址须为 HTTP 或 HTTPS，密钥请填入 API Key");
  if (
    !protocols.includes(protocol) ||
    (key != null &&
      (typeof key !== "string" || key.length > 8192 || /[\r\n]/.test(key)))
  )
    throw fail("请检查接口协议与 API Key");
  return {
    protocol,
    baseUrl: url.href.replace(/\/+$/, ""),
    key: key?.trim() || "",
  };
}

function withSavedKey(connection, saved) {
  const sameService =
    saved &&
    saved.protocol === connection.protocol &&
    saved.baseUrl === connection.baseUrl;
  return {
    ...connection,
    key: connection.key || (sameService && saved.key) || "",
  };
}

async function draftConnection(draft) {
  const connection = validateConnection(draft);
  if (!draft.id) return connection;
  const saved = (await settings()).promptModels?.find((p) => p.id === draft.id);
  if (!saved) throw fail("模型配置已删除", 404);
  return withSavedKey(connection, saved);
}

async function discoverModels(profile) {
  const { protocol } = profile;
  const models = new Map();
  const cursors = new Set();
  const signal = AbortSignal.timeout(30000);
  let cursor = "";
  do {
    const query = new URLSearchParams();
    if (protocol === "gemini") {
      query.set("pageSize", "1000");
      if (cursor) query.set("pageToken", cursor);
    } else if (protocol === "anthropic") {
      query.set("limit", "1000");
      if (cursor) query.set("after_id", cursor);
    }
    const data = await providerJson(
      profile,
      "/models" + (query.size ? "?" + query : ""),
      { method: "GET" },
      signal,
    );
    const rows = protocol === "gemini" ? data?.models : data?.data;
    if (
      !Array.isArray(rows) &&
      !(
        protocol === "gemini" &&
        rows === undefined &&
        data &&
        Object.keys(data).length === 0
      )
    )
      throw fail("服务未返回有效的模型列表", 502);
    for (const row of rows || []) {
      if (
        protocol === "gemini" &&
        Array.isArray(row?.supportedGenerationMethods) &&
        !row.supportedGenerationMethods.includes("generateContent")
      )
        continue;
      if (
        Array.isArray(row?.output_modalities) &&
        !row.output_modalities.includes("text")
      )
        continue;
      const id =
        protocol === "gemini" && typeof row?.name === "string"
          ? row.name.replace(/^models\//, "")
          : row?.id;
      if (!scalar(id, 256)) continue;
      const name = row.display_name || row.displayName;
      models.set(id, { id, name: scalar(name, 256) ? name : id });
    }
    cursor =
      protocol === "gemini"
        ? data.nextPageToken
        : protocol === "anthropic" && data.has_more
          ? data.last_id
          : "";
    if (protocol === "anthropic" && data.has_more && !cursor)
      throw fail("服务未返回下一页模型的位置，请重试", 502);
    if (cursor && (typeof cursor !== "string" || cursors.has(cursor)))
      throw fail("模型分页信息无效，请重试", 502);
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return [...models.values()].sort((a, b) =>
    a.id.localeCompare(b.id, "en", { numeric: true }),
  );
}

export function registerOptimizer(api) {
  api.get("/prompt-models", async (_req, res) =>
    res.json(list(await settings())),
  );
  api.post("/prompt-models/discover", async (req, res) => {
    const connection = await draftConnection(req.body || {});
    res.json({ models: await discoverModels(connection) });
  });
  api.post("/prompt-models/test", async (req, res) => {
    const draft = req.body || {};
    if (!scalar(draft.model, 256)) throw fail("请先选择或填写模型 ID");
    const profile = {
      ...(await draftConnection(draft)),
      model: draft.model.trim(),
    };
    const start = performance.now();
    await requestCompletion(
      profile,
      "This is a connectivity check.",
      "Reply with OK.",
      { test: true },
    );
    res.json({
      model: profile.model,
      elapsedMs: Math.round(performance.now() - start),
    });
  });
  api.post("/prompt-models", async (req, res) => {
    const { id, name, model, protocol, baseUrl, key } = req.body || {};
    if (!scalar(name, 100) || !scalar(model, 256))
      throw fail("请填写显示名称和模型 ID");
    const connection = validateConnection({ protocol, baseUrl, key });
    const profileId = id || randomUUID();
    const state = await changeSettings((s) => {
      const rows = (s.promptModels ||= []);
      const i = rows.findIndex((p) => p.id === profileId);
      if (id && i < 0) throw fail("模型配置已删除", 404);

      const next = {
        id: profileId,
        name: name.trim(),
        model: model.trim(),
        ...withSavedKey(connection, rows[i]),
      };
      if (i < 0) rows.push(next);
      else rows[i] = next;
    });
    res.json(publicProfile(state.promptModels.find((p) => p.id === profileId)));
  });
  api.delete("/prompt-models/:id", async (req, res) => {
    await changeSettings((s) => {
      s.promptModels = (s.promptModels || []).filter(
        (p) => p.id !== req.params.id,
      );
    });
    res.json({ ok: true });
  });
  api.post("/prompt-optimizer/run", async (req, res) => {
    const context = validateContext(req.body?.context);
    const profile = (await settings()).promptModels?.find(
      (p) => p.id === req.body.profileId,
    );
    if (!profile) throw fail("请选择已配置的提示词模型", 404);
    const {projectId,nodeId,basis} = req.body;
    if (projectId !== undefined) {
      if (!scalar(projectId,160) || !scalar(nodeId,160) || !scalar(basis,120000))
        throw fail("优化任务缺少有效的项目和节点");
      const board = await readProject(projectId);
      const node = board.nodes.find(n => n.id === nodeId && n.data.kind === context.kind);
      if (!node) throw fail("优化的节点已不存在",404);
      pruneTasks();
      const key = taskKey(projectId,nodeId);
      const existing = optimizationTasks.get(key);
      if (existing?.status === "running") return res.status(202).json(publicTask(existing));
      const controller = new AbortController();
      const task = {id:randomUUID(),projectId,nodeId,basis,started:Date.now(),status:"running",controller};
      optimizationTasks.set(key,task);
      void complete(profile,context,controller.signal).then(
        text => { if (!controller.signal.aborted) Object.assign(task,{status:"done",text,modelName:profile.name}); },
        error => { if (!controller.signal.aborted) Object.assign(task,{status:"failed",error:error.message}); },
      ).finally(() => { task.finished = Date.now(); });
      return res.status(202).json(publicTask(task));
    }
    if (res.destroyed) return;
    const controller = new AbortController();
    const abort = () => controller.abort();
    res.once("close", abort);
    try {
      const text = await complete(profile, context, controller.signal);
      if (!controller.signal.aborted) res.json({ text, modelName: profile.name });
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    } finally {
      res.off("close", abort);
    }
  });
  api.get("/projects/:id/prompt-optimizations", (req,res) => {
    pruneTasks();
    res.json([...optimizationTasks.values()].filter(task => task.projectId === req.params.id).map(publicTask));
  });
  api.delete("/projects/:id/prompt-optimizations/:nodeId/:taskId", (req,res) => {
    const key = taskKey(req.params.id,req.params.nodeId);
    const task = optimizationTasks.get(key);
    if (task?.id === req.params.taskId) {
      task.controller.abort();
      optimizationTasks.delete(key);
    }
    res.json({ok:true});
  });
}
