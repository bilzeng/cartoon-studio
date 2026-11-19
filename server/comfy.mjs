import { watchExecution } from "./comfy-progress.mjs";
import { workloadKey, executionDuration } from "./generation-timing.mjs";
import { currentUrl, defaultUrl, currentToken } from "./environments.mjs";
import { imageCatalog, buildImageGraph } from "./image-workflows.mjs";
import { matchSplitModels, wanGraph } from "./recipes.mjs";
import { ratios } from "../shared/series.js";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { makeId } from "../shared/studio.js";
import { assetPath, fail, storeAsset } from "./storage.mjs";
import { h3VideoReference, restoreVideoAudio } from "./render.mjs";

async function request(route, options = {}, allowMissing = false, timeout = 20000, stage = "连接 ComfyUI") {
  const base = currentUrl();
  const headers = { ...options.headers };
  if (typeof options.body === "string")
    headers["Content-Type"] = "application/json";
  const token = currentToken();
  if (token) headers.Authorization = "Bearer " + token;
  let response;
  try {
    response = await fetch(base.replace(/\/$/, "") + route, {
      ...options,
      headers,
      redirect: "error",
      signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout),
    });
  } catch (e) {
    options.signal?.throwIfAborted();
    const detail = e.name === "TimeoutError" ? "超时（" + Math.round(timeout / 1000) + " 秒）" : "时连接中断";
    throw fail(stage + detail + "，请检查 ComfyUI 服务和网络连接", 503);
  }
  if (allowMissing && (response.status === 404 || (allowMissing === "cancel" && response.status === 405))) return null;
  if (!response.ok) {
    const result =
      route === "/prompt" ? await response.json().catch(() => null) : null;
    const errors = Object.values(result?.node_errors || {}).flatMap((n) =>
      (n.errors || []).map((e) =>
        [n.class_type, e.message, e.details].filter(Boolean).join(" "),
      ),
    );
    const detail = errors.join(" / ").slice(0, 520) || result?.error?.message;
    throw fail(
      stage + "，ComfyUI 返回 HTTP " +
        response.status +
        (detail ? " · " + detail : "，请检查工作流、模型和服务权限"),
      502,
    );
  }
  return response;
}
export async function cancelComfyPrompt(id) {
  if (!id) throw fail("ComfyUI 没有返回任务编号", 502);
  const post = body => ({ method: "POST", body: JSON.stringify(body) });
  const queue = async () => {
    const state = await (await request("/queue")).json();
    if (!Array.isArray(state.queue_running) || !Array.isArray(state.queue_pending))
      throw fail("未能确认 ComfyUI 队列状态，请重试", 502);
    return state;
  };
  const contains = rows => rows?.some(row => row[1] === id);
  const finishedOrRemoved = async () => {
    const history = await (await request("/history/" + encodeURIComponent(id))).json();
    const item = history[id];
    if (!item || item.status?.messages?.some(([type]) => type === "execution_interrupted")) return;
    throw fail("任务已结束，请查看最新结果", 409);
  };
  const result = await request("/api/jobs/" + encodeURIComponent(id) + "/cancel", post({}), "cancel");
  if (result) {
    const { cancelled } = await result.json();
    if (cancelled === true) return;
    if (cancelled !== false) throw fail("ComfyUI 未确认取消，请重试", 502);
    // The first cancellation may have succeeded before its response was lost.
    const state = await queue();
    if (contains(state.queue_running) || contains(state.queue_pending))
      throw fail("任务仍在 ComfyUI 队列中，请重试", 409);
    return finishedOrRemoved();
  }
  // Older ComfyUI versions only have queue deletion and a separate interrupt.
  let state = await queue();
  if (contains(state.queue_pending)) {
    await request("/queue", post({ delete: [id] }));
    state = await queue();
    if (contains(state.queue_pending)) throw fail("任务仍在排队，请再试一次", 409);
  }
  if (!contains(state.queue_running)) return finishedOrRemoved();
  const { version } = await testConnection();
  const parts = /^(\d+)\.(\d+)\.(\d+)/.exec(version)?.slice(1).map(Number);
  // v0.3.57 introduced prompt_id matching in the legacy /interrupt handler.
  if (!parts || !(parts[0] > 0 || parts[1] > 3 || (parts[1] === 3 && parts[2] >= 57)))
    throw fail("当前 ComfyUI 版本仅支持取消排队任务。升级后可单独停止执行中的任务", 409);
  await request("/interrupt", post({ prompt_id: id }));
}
export async function testConnection() {
  const response = await request("/system_stats");
  const info = await response.json().catch(() => null);
  if (!info?.system || !Array.isArray(info.devices))
    throw fail("这个地址没有返回 ComfyUI 服务信息");
  return {
    version: info.system.comfyui_version || "",
    device: info.devices[0]?.name || "",
  };
}
export async function nodeInfo(type) {
  const response = await request(
    "/object_info/" + encodeURIComponent(type),
    {},
    true,
  );
  return response && (await response.json())[type];
}
export async function loraFiles() {
  const result = await request("/experiment/models/loras", {}, true);
  const files = await result?.json().catch(() => []);
  return Array.isArray(files)
    ? files.filter(
        (f) => typeof f.name === "string" && Number.isInteger(f.pathIndex),
      )
    : [];
}
export async function loraPreview(name, index) {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    typeof name !== "string" ||
    name.split(/[/\\]/).some((part) => !part || part === "." || part === "..")
  )
    throw fail("LoRA 文件无效");
  return request(
    "/experiment/models/preview/loras/" +
      index +
      "/" +
      name.split(/[/\\]/).map(encodeURIComponent).join("/"),
    {},
    true,
  );
}
export async function dimensionConstraints(type) {
  const required = (await nodeInfo(type))?.input?.required;
  return ["width", "height"].map((key) => {
    const opts = required?.[key]?.[1] || {};
    return { min: opts.min, max: opts.max, step: opts.step };
  });
}
export async function definitionsFor(graphs) {
  const graphTypes = graphs.flatMap((g) => Object.values(g).map((n) => n.class_type));
  const types = [
    ...new Set([
      ...graphTypes,
      ...(graphs.length ? ["LoraLoaderModelOnly"] : []),
      ...(graphTypes.includes("MiniMaxH3ReferenceToVideo") ? ["LoadAudio", "LoadVideo", "GetVideoComponents", "ManualSigmas"] : []),
    ]),
  ];
  const entries = [];
  for (let i = 0; i < types.length; i += 6)
    entries.push(
      ...(await Promise.all(
        types.slice(i, i + 6).map(async (type) => [type, await nodeInfo(type)]),
      )),
    );
  return Object.fromEntries(entries);
}
async function folderModels(folder) {
  const binding = {
    checkpoints: ["CheckpointLoaderSimple", "ckpt_name"],
    diffusion_models: ["UNETLoader", "unet_name"],
    vae: ["VAELoader", "vae_name"],
    text_encoders: ["CLIPLoader", "clip_name"],
    loras: ["LoraLoaderModelOnly", "lora_name"],
  }[folder];
  if (binding) {
    const def = await nodeInfo(binding[0]);
    const spec = def?.input?.required?.[binding[1]];
    const options = Array.isArray(spec?.[0]) ? spec[0] : spec?.[1]?.options;
    if (Array.isArray(options))
      return options.filter((f) => typeof f === "string");
  }
  const response = await request("/models/" + folder, {}, true);
  if (!response) return [];
  const files = await response.json();
  if (!Array.isArray(files) || files.some((f) => typeof f !== "string"))
    throw fail("ComfyUI 模型清单格式无效", 502);
  return files;
}
export const models = () => folderModels("checkpoints");
export async function discoverSplit() {
  const folders = ["diffusion_models", "text_encoders", "vae", "loras"];
  const lists = await Promise.all(folders.map(folderModels));
  const inventory = Object.fromEntries(
    folders.map((key, i) => [key, lists[i]]),
  );
  const found = matchSplitModels(inventory);
  if (found.wan) {
    try {
      const info = await (
        await request("/object_info/VHS_VideoCombine")
      ).json();
      const format = info.VHS_VideoCombine?.input?.required?.format;
      const choices = Array.isArray(format?.[0])
        ? format[0]
        : format?.[1]?.options || [];
      if (!choices.includes("video/h264-mp4")) found.wan = null;
    } catch {
      found.wan = null;
    }
  }
  const modern = inventory.diffusion_models.some((n) =>
    /krea[-_ ]?2|qwen[-_ ]?image[-_ ]?2/i.test(n),
  );
  const [clip, edit, patch, qwen, lora] = await Promise.all([
    ...(modern
      ? [
          "CLIPLoader",
          "Krea2EditGroundedEncode",
          "Krea2EditModelPatch",
          "TextEncodeQwenImage21",
        ].map(nodeInfo)
      : [null, null, null, null]),
    inventory.loras.length ? nodeInfo("LoraLoaderModelOnly") : null,
  ]);
  const types = clip?.input?.required?.type;
  const clipTypes = Array.isArray(types?.[0])
    ? types[0]
    : types?.[1]?.options || [];
  const catalog = imageCatalog(inventory, found.zImage, {
    kreaClip: clipTypes.includes("krea2"),
    kreaEdit: !!(
      edit?.input?.optional?.image_b && patch?.input?.optional?.source_latent_b
    ),
    qwen: !!qwen && clipTypes.includes("qwen_image"),
    qwenRefs: qwen?.input?.required?.images?.[1]?.template?.names?.length || 0,
    lora: !!lora,
  });
  return { ...found, inventory, catalog };
}
export const customImageId = "studio:custom-image";
export async function customWorkflow(kind) {
  const image = kind === "image";
  const variable = image ? "COMFYUI_IMAGE_WORKFLOW" : "COMFYUI_VIDEO_WORKFLOW";
  const file = process.env[variable];
  if (!file || currentUrl() !== defaultUrl()) return null;
  let graph;
  try {
    graph = JSON.parse(await readFile(file, "utf8"));
  } catch {
    throw fail("工作流文件无法读取，请检查 " + variable, 503);
  }
  if (
    !graph ||
    typeof graph !== "object" ||
    Array.isArray(graph) ||
    !Object.values(graph).every((n) => n?.class_type && n.inputs) ||
    !JSON.stringify(graph).includes('"{{prompt}}"')
  )
    throw fail(
      variable + " 需为 ComfyUI 的 API 格式，并包含 {{prompt}} 输入",
      503,
    );
  return {
    graph,
    name: image ? "自定义图片工作流" : "自定义视频工作流",
    needsImage: JSON.stringify(graph).includes('"{{image}}"'),
  };
}
export async function videoConfig(split) {
  return (
    (await customWorkflow("video")) ||
    (split?.wan
      ? {
          graph: wanGraph(split.wan),
          needsImage: false,
          name: "Wan 2.1 · 文生视频",
          native: true,
        }
      : null)
  );
}
async function execute(graph, seed, progress, findOutput, trackSteps = false) {
  const clientId = makeId();
  const watch = trackSteps ? watchExecution(currentUrl(), currentToken(), clientId, graph) : null;
  try {
    await watch?.ready;
    const send = async () => (
      await request("/prompt", {
        method: "POST",
        body: JSON.stringify({ prompt: graph, client_id: clientId }),
      }, false, 20000, "提交工作流")
    ).json();
    const ticket = await (progress.submit ? progress.submit(send) : send());
    if (!ticket.prompt_id) throw fail("ComfyUI 未接收任务", 502);
    watch?.bind(ticket.prompt_id);
    await progress(
      "已送入 ComfyUI 队列 · Seed " + seed + " · " + ticket.prompt_id,
      { promptId: ticket.prompt_id, phase: "queued", workloadKey: workloadKey(currentUrl(), graph) },
    );
    return await collectResult(ticket.prompt_id, watch, progress, findOutput);
  } finally {
    watch?.close();
  }
}

async function collectResult(promptId, watch, progress, findOutput) {
  let lastStep, lastStream, executionObservedAt, lastQueuePosition;
  const deadline = Date.now() + 60 * 60 * 1000;
  let historyFailures = 0;
  let nextQueueCheck = 0;
  while (Date.now() < deadline) {
    await sleep(2000, undefined, { signal: progress.signal });
    const { stream, step } = watch?.read() || {};
    if (step !== lastStep || stream !== lastStream) {
      const update = { progressStream: stream };
      if (step) {
        executionObservedAt ??= step.startedAt;
        Object.assign(update, { phase: "executing", executionObservedAt, step });
        nextQueueCheck = Infinity;
      }
      await progress(step || executionObservedAt ? "ComfyUI 正在执行" : "已送入 ComfyUI 队列 · " + promptId, update);
      lastStep = step;
      lastStream = stream;
    }
    let history;
    try {
      history = await (
        await request("/history/" + encodeURIComponent(promptId), { signal: progress.signal }, false, 20000, "查询生成进度")
      ).json();
      historyFailures = 0;
    } catch (error) {
      if (error.status === 503 && ++historyFailures < 4) continue;
      throw fail("查询生成进度失败 · " + promptId + " · " + error.message, 502);
    }
    const item = history[promptId];
    if (!item) {
      if (Date.now() >= nextQueueCheck) {
        nextQueueCheck = Date.now() + 6000;
        // Queue telemetry is optional on older servers and proxies.
        const queue = await request("/queue", {}, true, 2500).then(r => r?.json()).catch(() => null);
        if (queue?.queue_running?.some(row => row[1] === promptId)) {
          nextQueueCheck = Infinity;
          executionObservedAt ??= new Date().toISOString();
          await progress("ComfyUI 正在执行", { phase: "executing", executionObservedAt });
        } else if (!queue) nextQueueCheck = Date.now() + 30000;
        else {
          const index = queue.queue_pending?.findIndex(row => row[1] === promptId) ?? -1;
          if (index >= 0 && index + 1 !== lastQueuePosition) {
            lastQueuePosition = index + 1;
            await progress("已送入 ComfyUI 队列", { phase: "queued", remoteQueuePosition: lastQueuePosition });
          }
        }
      }
      continue;
    }
    const executionMs = executionDuration(item.status?.messages);
    const execution = executionMs === null ? {} : { executionMs };
    if (item.status?.messages?.some(([type]) => type === "execution_interrupted"))
      throw Object.assign(fail("已取消生成", 409), { code: "GENERATION_CANCELLED" });
    if (item.status?.status_str === "error") {
      const error = item.status?.messages?.find(
        ([type]) => type === "execution_error",
      )?.[1];
      if (executionMs !== null) await progress("ComfyUI 执行失败", execution);
      throw fail(
        "模型执行失败 · " +
          [error?.node_type, error?.exception_message?.slice(0, 420)]
            .filter(Boolean)
            .join(" ") +
          " · " +
          promptId,
      );
    }
    const output = findOutput(item.outputs || {});
    if (!output) {
      if (item.status?.completed) throw fail("工作流没有输出支持的文件");
      continue;
    }
    const query = new URLSearchParams({
      filename: output.filename,
      subfolder: output.subfolder || "",
      type: output.type || "output",
    });
    await progress("正在下载生成结果 · " + promptId, { phase: "downloading", ...execution });
    const response = await request("/view?" + query, {}, false, 600000, "下载生成结果");
    const chunks = [];
    let size = 0;
    try {
      for await (const chunk of response.body) {
        size += chunk.byteLength;
        if (size > 128 * 1024 * 1024) throw fail("生成文件超过 128 MB");
        chunks.push(chunk);
      }
    } catch (e) {
      if (e.status) throw e;
      throw fail("下载生成结果时连接中断 · " + promptId, 503);
    }
    return Buffer.concat(chunks);
  }
  throw fail("等待超过 60 分钟，请在 ComfyUI 历史中检查结果");
}
export async function generateImage(
  {
    projectId,
    checkpoint,
    prompt,
    assetTitle,
    seed,
    imageModel,
    options,
    config,
    ratio = "16:9",
    dimensions,
    asset,
    references = asset ? [asset] : [],
    media,
  },
  progress,
) {
  const [width, height] = dimensions || ratios[ratio].image;
  const template =
    config?.graph ||
    (imageModel &&
      buildImageGraph(imageModel, options, width, height, references.length));
  const graph = template
    ? await bindGraph(template, {
        prompt,
        seed,
        asset,
        references,
        media,
        progress,
        width,
        height,
      })
    : {
        1: {
          class_type: "CheckpointLoaderSimple",
          inputs: { ckpt_name: checkpoint },
        },
        2: {
          class_type: "CLIPTextEncode",
          inputs: { clip: ["1", 1], text: prompt },
        },
        3: {
          class_type: "CLIPTextEncode",
          inputs: { clip: ["1", 1], text: "" },
        },
        4: {
          class_type: "EmptyLatentImage",
          inputs: { width, height, batch_size: 1 },
        },
        5: {
          class_type: "KSampler",
          inputs: {
            model: ["1", 0],
            positive: ["2", 0],
            negative: ["3", 0],
            latent_image: ["4", 0],
            seed,
            steps: 20,
            cfg: 7,
            sampler_name: "euler",
            scheduler: "normal",
            denoise: 1,
          },
        },
        6: {
          class_type: "VAEDecode",
          inputs: { samples: ["5", 0], vae: ["1", 2] },
        },
        7: {
          class_type: "SaveImage",
          inputs: { images: ["6", 0], filename_prefix: "CartoonStudio" },
        },
      };
  const bytes = await execute(graph, seed, progress, (o) =>
    (config?.output ? [o[config.output] || {}] : Object.values(o))
      .flatMap((n) => n.images || [])
      .find((f) => f.type !== "temp"),
  );
  let extension;
  if (bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")))
    extension = "png";
  else if (bytes.subarray(0, 3).toString("hex") === "ffd8ff") extension = "jpg";
  else if (
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  )
    extension = "webp";
  else throw fail("图片工作流应返回 PNG、JPEG 或 WebP");
  return storeAsset(bytes, extension, "image", assetTitle + " · " + seed, { projectId, origin: "generated" });
}
async function bindGraph(
  template,
  { asset, references = [], media, prompt, seed, width, height, frames, progress, prepareVideoRefs },
) {
  const values = {
    "{{prompt}}": prompt,
    "{{seed}}": seed,
    "{{width}}": width,
    "{{height}}": height,
    "{{frames}}": frames,
  };
  const imageSlots = new Map([
    ["{{image}}", asset],
    [
      "{{resource:circle-mask}}",
      {
        kind: "image",
        resource: new URL("./presets/circle-mask.png", import.meta.url),
      },
    ],
    ...Object.entries(media || { image: references }).flatMap(([kind, items]) =>
      items.map((ref, i) => ["{{" + kind + (i + 1) + "}}", ref]),
    ),
  ]);
  const serialized = JSON.stringify(template);
  const usedSlots = [...imageSlots].filter(([slot]) => serialized.includes(JSON.stringify(slot)));
  for (const [index, [slot, asset]] of usedSlots.entries()) {
    if (!asset || !["image", "video", "audio"].includes(asset.kind))
      throw fail("工作流所需的素材未绑定");
    const prepare = prepareVideoRefs && asset.kind === "video";
    if (prepare) await progress?.("正在准备参考视频「" + asset.name + "」");
    const path = asset.resource || (await assetPath(asset));
    const ext = prepare ? "mp4" : asset.resource ? "png" : path.split(".").pop();
    const bytes = prepare ? await h3VideoReference(asset) : await readFile(path);
    const name = "cartoon-" + createHash("sha256").update(bytes).digest("hex") + "." + ext;
    const data = new FormData();
    data.append("image", new Blob([bytes]), name);
    const label = asset.kind === "image" ? "上传参考图" : "上传参考素材";
    const stage = label + "「" + (asset.name || slot) + "」";
    // Media transfers over remote tunnels routinely outlast metadata requests.
    const timeout = Math.max(120000, 60000 + Math.ceil(bytes.length / 32768) * 1000);
    let uploaded;
    for (let attempt = 0; attempt < 2; attempt++) {
      await progress?.((attempt ? "正在重试" : "正在") + stage, {
        phase: "uploading",
        upload: { current: index + 1, total: usedSlots.length, updatedAt: new Date().toISOString() },
      });
      try {
        const response = await request("/upload/image", { method: "POST", body: data, signal: progress?.signal }, false, timeout, stage);
        uploaded = await response.json();
        break;
      } catch (e) {
        if (e.status !== 503 || attempt) throw e;
      }
    }
    if (!uploaded?.name) throw fail(stage + "失败，ComfyUI 未返回文件名", 502);
    values[slot] = [uploaded.subfolder, uploaded.name]
      .filter(Boolean)
      .join("/");
  }
  return JSON.parse(JSON.stringify(template), (_key, value) =>
    typeof value === "string" && Object.hasOwn(values, value)
      ? values[value]
      : value,
  );
}
export async function generateVideo(
  {
    projectId,
    config,
    asset,
    references,
    media,
    sourceAudioAsset,
    prompt,
    assetTitle,
    seed,
    dimensions,
    ratio = "16:9",
    duration = 3,
  },
  progress,
) {
  const [width, height] = dimensions || ratios[ratio].video;
  const seconds = config.native ? Math.min(5, duration) : duration;
  const frames = 4 * Math.round((seconds * 16 - 1) / 4) + 1;
  const graph = await bindGraph(config.graph, {
    asset,
    references,
    media,
    prompt,
    seed,
    width,
    height,
    frames,
    progress,
    prepareVideoRefs: config.prepareVideoRefs,
  });
  const bytes = await execute(graph, seed, progress, (outputs) =>
    (config.output ? [outputs[config.output] || {}] : Object.values(outputs))
      .flatMap((o) => [
        ...(o.videos || []),
        ...(o.gifs || []),
        ...(o.images || []),
      ])
      .find((o) => o.type !== "temp" && /\.(mp4|mov|webm)$/i.test(o.filename)),
    true,
  );
  const ext =
    bytes.toString("ascii", 4, 8) === "ftyp"
      ? bytes.toString("ascii", 8, 12) === "qt  "
        ? "mov"
        : "mp4"
      : bytes.subarray(0, 4).toString("hex") === "1a45dfa3" &&
          bytes.subarray(0, 64).includes(Buffer.from("webm"))
        ? "webm"
        : null;
  if (!ext) throw fail("视频工作流需要输出 MP4、MOV 或 WebM");
  const master = sourceAudioAsset ? await restoreVideoAudio(bytes, assetPath(sourceAudioAsset)) : bytes;
  return storeAsset(master, ext, "video", assetTitle + " · " + seed + "." + ext, { projectId, origin: "generated" });
}

export async function generateAudio(
  { projectId, config, media, prompt, seed, assetTitle },
  progress,
) {
  const graph = await bindGraph(config.graph, { media, prompt, seed, progress });
  const bytes = await execute(graph, seed, progress, (outputs) =>
    (outputs[config.output]?.audio || []).find((f) => f.type !== "temp"),
  );
  const header = bytes.toString("ascii", 0, 4);
  const ext =
    header === "fLaC"
      ? "flac"
      : header === "OggS"
        ? "ogg"
        : header === "RIFF" && bytes.toString("ascii", 8, 12) === "WAVE"
          ? "wav"
          : bytes.toString("ascii", 0, 3) === "ID3" ||
              (bytes[0] === 255 && (bytes[1] & 224) === 224)
            ? "mp3"
            : bytes.toString("ascii", 4, 8) === "ftyp"
              ? "m4a"
              : "";
  if (!ext) throw fail("音频工作流没有返回可播放的音频文件");
  return storeAsset(bytes, ext, "audio", assetTitle + " · " + seed, { projectId, origin: "generated" });
}
