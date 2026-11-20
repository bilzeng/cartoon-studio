import { isCharacterCard } from "../shared/character-card.js";
import { inspectStageModel, stageModelLimit } from "../shared/stage-model.js";
import { jobTimes } from "../shared/job-timing.js";
import { registerDirectorScene } from "./director-scene.mjs";
import { registerOptimizer } from "./prompt-optimizer.mjs";
import { optimizationContext, effectivePrompt } from "../shared/prompt-optimizer.js";
import { spawn } from "node:child_process";
import path from "node:path";
import { findBoard, listBoardFiles, locateAssetFile, organizeWorkspace } from "./project-files.mjs";
import { assetCatalog } from "./asset-library.mjs";
import { updateTags } from "../shared/asset-tags.js";
import { settings, changeSettings, mediaDir, projectsDir } from "./files.mjs";
import { editorGraph, editorNodes } from "./editor-workflow.mjs";
import { isVideoUpscale, outputSize, sizeError, videoUpscale4kId } from "../shared/generation-size.js";
import { isImageRestoreModel, relayOriginalRestoreModelId, relayRestoreModelId, secondPassRestoreId } from "../shared/image-restore.js";
import { h3ContinuationFields, h3ContinuationModelId } from "../shared/h3-video.js";
import { poseOutfitGalleryTag, poseSwapModelId } from "../shared/pose-swap.js";
import { bindPoseSwap } from "./presets/pose-swap.mjs";
import { poseGallery, downloadPoseReference } from "./pose-gallery.mjs";
import {
  checkedGraph,
  savePresetFiles,
  inspectGraph,
  checkBindings,
  storePreset,
  readPresets,
  describePreset,
  bindPreset,
} from "./workflow-presets.mjs";
import {
  canvasInputs,
  resolveImages,
  resolveWorkflowInputs,
  resolveVideoInputs,
  mediaReferenceError,
} from "../shared/canvas.js";
import express from "express";
import { isPanoramaModel, panoramaLineage } from "../shared/image-actions.js";
import { imageOptions, selectedLoras } from "./image-workflows.mjs";
import {
  normalizeUrl,
  maxSideFor,
  environments,
  currentUrl,
  withEnvironment,
  saveEnvironment,
} from "./environments.mjs";
import { seriesPrompt } from "../shared/series.js";
import {
  shotPrompt as composeShot,
  referencesForShot,
  shotFields,
} from "../shared/storyboard.js";
import { randomInt } from "node:crypto";
import { makeBoard, makeId } from "../shared/studio.js";
import {
  allAssets,
  assetPath,
  fail,
  readProject,
  listProjects,
  saveProject,
  jobs,
  storeAsset,
  validateBoard,
} from "./storage.mjs";
import { enqueue, cancelJob, canRecoverJob, recoverJob, scheduleJobs } from "./generation-queue.mjs";
import { exportPlan } from "./render.mjs";
import {
  customWorkflow,
  loraPreview,
  loraFiles,
  dimensionConstraints,
  customImageId,
  definitionsFor,
  nodeInfo,
  testConnection,
  models,
  videoConfig,
  discoverSplit,
} from "./comfy.mjs";

await organizeWorkspace();

function sniff(b) {
  if (b.subarray(0, 8).toString("hex") === "89504e470d0a1a0a")
    return ["png", "image"];
  if (b.subarray(0, 3).toString("hex") === "ffd8ff") return ["jpg", "image"];
  if (
    b.toString("ascii", 0, 4) === "RIFF" &&
    b.toString("ascii", 8, 12) === "WEBP"
  )
    return ["webp", "image"];
  if (
    b.toString("ascii", 0, 4) === "RIFF" &&
    b.toString("ascii", 8, 12) === "WAVE"
  )
    return ["wav", "audio"];
  if (b.toString("ascii", 4, 8) === "ftyp") {
    const brand = b.toString("ascii", 8, 12);
    if (["M4A ", "M4B "].includes(brand)) return ["m4a", "audio"];
    if (
      ["isom", "iso2", "mp41", "mp42", "avc1", "M4V ", "qt  "].includes(brand)
    )
      return ["mp4", "video"];
  }
  if (
    b.toString("ascii", 0, 3) === "ID3" ||
    (b[0] === 255 && (b[1] & 224) === 224)
  )
    return ["mp3", "audio"];
  if (b.toString("ascii", 0, 4) === "fLaC") return ["flac", "audio"];
  if (b.toString("ascii", 0, 4) === "OggS") return ["ogg", "audio"];
  if (
    b.subarray(0, 4).toString("hex") === "1a45dfa3" &&
    b.subarray(0, 64).includes(Buffer.from("webm"))
  )
    return ["webm", "video"];
  throw fail("支持图片、MP4/MOV/WebM 视频及 WAV、MP3、M4A、FLAC、OGG 音频");
}

async function openFolder(dir, file) {
  const cmd = process.platform === "win32" ? "explorer.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = file && process.platform === "darwin" ? ["-R", file]
    : file && process.platform === "win32" ? ["/select," + file] : [dir];
  await new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.once("error", () => reject(fail("无法打开系统文件管理器", 503)));
    if (process.platform === "darwin") {
      child.once("close", code => code === 0 ? resolve() : reject(fail("访达未能显示所选文件或目录", 503)));
    } else {
      child.once("spawn", () => { child.unref(); resolve(); });
    }
  });
}

export function studioApi() {
  scheduleJobs();
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    const host = (req.headers.host || "").split(":")[0];
    if (!["127.0.0.1", "localhost"].includes(host))
      return res.status(403).send("仅支持本机访问");
    if (
      req.headers.origin &&
      req.headers.origin !== "http://" + req.headers.host
    )
      return res.status(403).send("请求来源不匹配");
    res.set("X-Content-Type-Options", "nosniff");
    next();
  });
  app.get("/media/:file", async (req, res, next) => {
    const asset = (await allAssets()).find((a) => a.file === req.params.file);
    if (!asset) return res.sendStatus(404);
    res.sendFile(
      await assetPath(asset),
      { maxAge: "1y", immutable: true, dotfiles: "allow" },
      (e) => {
        if (e) next(e);
      },
    );
  });
  const api = express.Router();
  app.use("/api", api);
  api.use(express.json({ limit: "4mb" }));
  registerOptimizer(api);
  registerDirectorScene(api);
  api.get("/projects", async (_req, res) => {
    res.json(await listProjects());
  });
  api.post("/projects", async (req, res) => {
    const { script = "", series, template, name } = req.body;
    if (typeof script !== "string" || script.length > 40000)
      throw fail("每集剧本最多 40000 字");
    const board = await validateBoard(
        req.body.board || {
          ...makeBoard(template, name, script, series),
          referenceCards: req.body.referenceCards,
        },
      ),
      id = makeId();
    res.status(201).json(await saveProject(id, board, 0));
  });
  api.get("/projects/:id", async (req, res) =>
    res.json(await readProject(req.params.id)),
  );
  api.put("/projects/:id", async (req, res) => {
    const board = await validateBoard(req.body);
    const revision = Number(req.body.revision);
    if (!Number.isSafeInteger(revision) || revision < 1)
      throw fail("项目版本无效", 409);
    res.json(await saveProject(req.params.id, board, revision));
  });
  api.post("/projects/:id/folder", async (req, res) => {
    const { folder } = await findBoard(req.params.id);
    await openFolder(path.join(projectsDir, folder));
    res.json({ opened: true });
  });
  api.post("/assets/:id/folder", async (req, res) => {
    const asset = (await allAssets()).find(a => a.id === req.params.id);
    if (!asset) throw fail("素材不存在", 404);
    const file = await locateAssetFile(asset, req.body?.projectId);
    await openFolder(path.dirname(file), file);
    res.json({ opened: true });
  });
  api.post("/assets/folder", async (_req, res) => {
    await openFolder(mediaDir);
    res.json({ opened: true });
  });
  api.get("/assets", async (_req, res) => {
    const [assets, history] = await Promise.all([allAssets(), jobs()]);
    const originals = new Map();
    const roots = new Set(assets.filter(a => a.kind === "image" && a.panorama).map(a => a.id));
    for (const job of history) {
      if (job.type === "image" && job.status === "done" && job.assetId && (job.panorama || isPanoramaModel(job.modelId))) roots.add(job.assetId);
      if (job.status !== "done" || !job.assetId || job.inputAssetIds?.length !== 1) continue;
      // Earlier restore jobs saved their preset description and input, but no model ID.
      const imageRestore = job.type === "image" && (job.modelId ? isImageRestoreModel(job.modelId)
        : /^高清修复 · 细节增强 \d+% · 长边 \d+ px$/.test(job.detail));
      const videoRestore = job.type === "video" && (job.modelId ? isVideoUpscale(job.modelId)
        : /^视频高清修复 · RelayVSR 二采 (2K|4K)(?: · |$)/.test(job.detail));
      if (imageRestore || videoRestore) originals.set(job.assetId, job.inputAssetIds[0]);
    }
    const panoramas = panoramaLineage(roots, originals);
    res.json(assets.map(a => ({ ...a, ...(originals.has(a.id) && {restoreSourceId:originals.get(a.id)}),
      ...(a.kind === "image" && panoramas.has(a.id) && {panorama:true}) })));
  });
  api.get("/assets/library", async (_req, res) => {
    const [assets, projects, history, prefs] = await Promise.all([allAssets(), listBoardFiles(), jobs(), settings()]);
    res.json(assetCatalog(assets.filter(a => a.kind !== "model"), projects, history, prefs.assetFavorites, prefs.assetTagEdits));
  });
  function tagList(values = []) {
    if (!Array.isArray(values) || values.some(t => typeof t !== "string" || !t.trim()))
      throw fail("标签必须是非空文字");
    return [...new Set(values.map(t => t.trim().normalize("NFC")))];
  }
  api.patch("/assets/tags", async (req, res) => {
    const { ids, add, remove, hide, show } = req.body || {};
    if (!Array.isArray(ids) || !ids.length) throw fail("请选择素材");
    const byId = new Map((await allAssets()).map(a => [a.id, a]));
    const targets = [...new Set(ids)];
    if (targets.some(id => !byId.has(id))) throw fail("素材不存在", 404);
    const [added, removed, hidden, shown] = [add, remove, hide, show].map(tagList);
    const changes = [];
    await changeSettings(s => {
      s.assetTagEdits ??= {};
      for (const id of targets) {
        const previous = s.assetTagEdits[id];
        const customTags = updateTags(previous?.customTags ?? byId.get(id).importTags, added, [...removed, ...hidden]);
        const hiddenTags = updateTags(previous?.hiddenTags, hidden, [...shown, ...added]);
        s.assetTagEdits[id] = { customTags, hiddenTags };
        changes.push({ id, customTags, hiddenTags });
      }
    });
    res.json(changes);
  });
  api.put("/assets/:id/favorite", async (req, res) => {
    const { id } = req.params;
    const favorite = req.body?.favorite;
    if (typeof favorite !== "boolean") throw fail("请选择收藏状态");
    if (!(await allAssets()).some(a => a.id === id)) throw fail("素材不存在", 404);
    await changeSettings(s => {
      const ids = new Set(s.assetFavorites);
      if (favorite) ids.add(id);
      else ids.delete(id);
      s.assetFavorites = [...ids];
    });
    res.json({ id, favorite });
  });
  api.post(
    "/assets",
    express.raw({ type: "application/octet-stream", limit: "64mb" }),
    express.raw({ type: "multipart/form-data", limit: "68mb" }),
    async (req, res) => {
      let bytes = req.body, importTags = [];
      if (req.is("multipart/form-data")) {
        let form;
        try {
          form = await new Response(bytes, { headers: { "Content-Type": req.get("Content-Type") } }).formData();
        } catch { throw fail("无法读取上传表单"); }
        const file = form.get("file");
        if (!(file instanceof Blob)) throw fail("请选择素材文件");
        if (file.size > 64 * 1024 * 1024) throw fail("单个素材超过 64 MB", 413);
        importTags = tagList(form.getAll("tag"));
        bytes = Buffer.from(await file.arrayBuffer());
      }
      if (!Buffer.isBuffer(bytes) || !bytes.length)
        throw fail("请选择素材文件");
      const [ext, kind] = sniff(bytes),
        name = String(req.query.name || "导入素材").slice(0, 150);
      const asset = await storeAsset(bytes, ext, kind, name, { projectId: req.query.project, importTags });
      res.status(asset.duplicate ? 200 : 201).json(asset);
    },
  );
  api.post("/projects/:id/stage-models", express.raw({type:"application/octet-stream",limit:stageModelLimit}), async (req,res) => {
    if (!Buffer.isBuffer(req.body)) throw fail("请选择模型文件");
    const name = String(req.query.name || "").slice(0,150);
    let model;
    try { model = inspectStageModel(req.body,name); }
    catch (error) { throw fail(error.message); }
    const asset = await storeAsset(req.body,model.format,"model",name,{projectId:req.params.id,model});
    res.status(asset.duplicate ? 200 : 201).json(asset);
  });
  api.get("/pose-swap/gallery/:role", async (req, res) => {
    res.json(await poseGallery(req.params.role));
  });
  api.post("/pose-swap/gallery/:role/:id", async (req, res) => {
    if (typeof req.body?.projectId !== "string") throw fail("请选择当前项目");
    const project = await readProject(req.body.projectId);
    const { bytes, name } = await downloadPoseReference(req.params.role, req.params.id);
    const [ext, kind] = sniff(bytes);
    if (kind !== "image") throw fail("图库返回了无法使用的图片", 502);
    const asset = await storeAsset(bytes, ext, kind, name + "." + ext, {
      projectId: project.id, importTags: req.params.role === "outfit" ? [poseOutfitGalleryTag] : [],
    });
    res.status(asset.duplicate ? 200 : 201).json(asset);
  });
  api.use(async (req, res, next) =>
    withEnvironment((await environments()).active, next),
  );
  api.get("/environments", async (_req, res) => res.json(await environments()));
  api.put("/environments", async (req, res) => {
    const url = normalizeUrl(req.body.url);
    const name = String(req.body.name || "").trim();
    if (!name || name.length > 80) throw fail("请填写 1 到 80 字的环境名称");
    const token = req.body.token;
    if (
      token !== undefined &&
      (typeof token !== "string" || token.length > 8192 || /[\r\n]/.test(token))
    )
      throw fail("令牌格式无效");
    const result = await withEnvironment(url, testConnection, token);
    await saveEnvironment(url, name, token, req.body.maxSide);
    res.json({ ...(await environments()), ...result });
  });
  async function importGraph(raw) {
    if (!Array.isArray(raw?.nodes)) {
      const graph = checkedGraph(raw);
      return { graph, definitions: await definitionsFor([graph]) };
    }
    const nodes = editorNodes(raw);
    const definitions = await definitionsFor([
      Object.fromEntries(nodes.map((n) => [n.id, { class_type: n.type }])),
    ]);
    return { graph: checkedGraph(editorGraph(raw, definitions)), definitions };
  }
  api.post("/workflows/inspect", async (req, res) => {
    const { graph, definitions } = await importGraph(req.body.graph);
    res.json({
      ...inspectGraph(graph, definitions),
      environment: currentUrl(),
    });
  });
  api.post("/workflows", async (req, res) => {
    if (req.body.environment !== currentUrl())
      throw fail("环境已切换，请重新导入", 409);
    const { graph, definitions } = await importGraph(req.body.graph);
    checkBindings(inspectGraph(graph, definitions), req.body.bindings);
    res
      .status(201)
      .json({ id: await storePreset(req.body.name, graph, req.body.bindings) });
  });
  api.put("/workflows/:id/files", async (req, res) => {
    if (req.body.environment !== currentUrl())
      throw fail("环境已切换，请重新打开配置", 409);
    const preset = (await readPresets()).find((p) => p.id === req.params.id);
    if (!preset) throw fail("预设不存在", 404);
    const descriptor = describePreset(
      preset,
      await definitionsFor([preset.graph]),
    );
    await savePresetFiles(preset, descriptor, req.body.values);
    res.json({ saved: true });
  });
  api.get("/lora-preferences", async (req, res) => {
    if (req.query.environment !== currentUrl()) throw fail("环境已切换", 409);
    const saved = (await settings()).preferences.find(
      (p) => p.environment === currentUrl(),
    );
    res.json({
      favorites: saved?.favorites || [],
      recent: saved?.recent || [],
    });
  });
  api.put("/lora-preferences", async (req, res) => {
    const { environment, action, name } = req.body;
    if (environment !== currentUrl()) throw fail("环境已切换", 409);
    const validName = (value) =>
      typeof value === "string" && value.length > 0 && value.length <= 1500;
    const imported = action === "import";
    if (imported) {
      if (
        ![req.body.favorites, req.body.recent].every(
          (list) => Array.isArray(list) && list.every(validName),
        )
      )
        throw fail("风格列表无效");
    } else if (!["star", "unstar", "use"].includes(action) || !validName(name))
      throw fail("风格名称无效");
    const state = await changeSettings((state) => {
      let prefs = state.preferences.find((p) => p.environment === environment);
      if (!prefs) {
        prefs = { environment, favorites: [], recent: [] };
        state.preferences.push(prefs);
      }
      if (imported) {
        prefs.favorites = [
          ...new Set([...prefs.favorites, ...req.body.favorites]),
        ];
        prefs.recent = [
          ...new Set([...prefs.recent, ...req.body.recent]),
        ].slice(0, 80);
      } else if (action === "use") {
        prefs.recent = [
          name,
          ...prefs.recent.filter((item) => item !== name),
        ].slice(0, 80);
      } else {
        prefs.favorites = prefs.favorites.filter((item) => item !== name);
        if (action === "star") prefs.favorites.push(name);
      }
    });
    const { favorites, recent } = state.preferences.find(
      (p) => p.environment === environment,
    );
    res.json({ favorites, recent });
  });
  api.get("/lora-cover", async (req, res) => {
    if (req.query.environment !== currentUrl()) throw fail("环境已切换", 409);
    const image = await loraPreview(req.query.name, Number(req.query.index));
    if (
      !image ||
      !/^image\/(webp|png|jpeg|gif|avif)\b/i.test(
        image.headers.get("content-type"),
      )
    )
      return res.sendStatus(404);
    res
      .set("Cache-Control", "private, max-age=3600")
      .type(image.headers.get("content-type"))
      .send(Buffer.from(await image.arrayBuffer()));
  });
  api.put("/lora-cover", async (req, res) => {
    const { environment, name, assetId } = req.body;
    if (environment !== currentUrl()) throw fail("环境已切换", 409);
    const asset = (await allAssets()).find(
      (a) => a.id === assetId && a.kind === "image",
    );
    if (!asset || !(await discoverSplit()).inventory.loras.includes(name))
      throw fail("请选择当前环境的 LoRA 和封面图片");
    await changeSettings((s) => {
      s.covers = s.covers.filter(
        (c) => c.environment !== environment || c.lora !== name,
      );
      s.covers.push({ environment, lora: name, assetId });
    });
    res.json({ url: asset.url });
  });
  api.get("/engine", async (_req, res) => {
    try {
      const [checkpoints, split] = await Promise.all([
        models(),
        discoverSplit(),
      ]);
      const presets = await readPresets(split.inventory),
        workflowModels = [],
        unavailable = [];
      // A broken or missing optional AICG3D plugin must not hide the other models.
      const definitions = await definitionsFor(presets
        .filter((p) => p.id !== h3ContinuationModelId)
        .map((p) => p.graph));
      for (const preset of presets) {
        try {
          const model = describePreset(preset, preset.id === h3ContinuationModelId
            ? await definitionsFor([preset.graph])
            : definitions);
          const missing = model.baseModel && model.fields.find(
            (f) => f.type === "choice" && !f.choices.includes(f.value),
          );
          if (missing) throw Error("当前环境缺少 " + missing.title + " 所需的 " + missing.value);
          workflowModels.push(model);
        } catch (e) {
          unavailable.push({
            id: preset.id,
            name: preset.name,
            kind: preset.bindings.kind || "image",
            reason: e.message,
          });
        }
      }
      let customImage = null,
        imageError = "";
      try {
        customImage = await customWorkflow("image");
      } catch (e) {
        imageError = e.message;
      }
      let video = null,
        videoError = "";
      try {
        const config = await videoConfig(split);
        if (config)
          video = {
            id: "studio:default-video",
            needsImage: config.needsImage,
            canDuration: JSON.stringify(config.graph).includes('"{{frames}}"'),
            canSize:
              JSON.stringify(config.graph).includes('"{{width}}"') &&
              JSON.stringify(config.graph).includes('"{{height}}"'),
            name: config.name,
            native: !!config.native,
          };
      } catch (e) {
        videoError = e.message;
      }
      const [previews, imageLimits, videoLimits, sd3Limits] = await Promise.all(
        [
          split.inventory.loras.length ? loraFiles().catch(() => []) : [],
          dimensionConstraints("EmptyLatentImage"),
          dimensionConstraints("EmptyHunyuanLatentVideo"),
          dimensionConstraints("EmptySD3LatentImage"),
        ],
      );
      const assets = await allAssets();
      const covers = (await settings()).covers
        .filter((c) => c.environment === currentUrl())
        .flatMap((c) => {
          const asset = assets.find((a) => a.id === c.assetId);
          return asset ? [[c.lora, asset.url]] : [];
        });
      res.json({
        online: true,
        environment: currentUrl(),
        checkpoints,
        inventory: { ...split.inventory, checkpoints },
        maxSide: await maxSideFor(),
        limits: { image: imageLimits, video: videoLimits, sd3: sd3Limits },
        loraCovers: Object.fromEntries(
          previews
            .map((f) => [
              f.name,
              "/api/lora-cover?" +
                new URLSearchParams({
                  environment: currentUrl(),
                  name: f.name,
                  index: f.pathIndex,
                }),
            ])
            .concat(covers),
        ),
        imageError,
        unavailable,
        imageModels: [
          ...(customImage
            ? [
                {
                  id: customImageId,
                  name: customImage.name,
                  canSize:
                    JSON.stringify(customImage.graph).includes('"{{width}}"') &&
                    JSON.stringify(customImage.graph).includes('"{{height}}"'),
                  reference: customImage.needsImage,
                  needsImage: customImage.needsImage,
                },
              ]
            : []),
          ...split.catalog,
          ...workflowModels.filter((m) => m.kind === "image"),
          ...checkpoints.map((id) => ({ id, name: id, reference: false })),
        ],
        video,
        audioModels: workflowModels.filter((m) => m.kind === "audio"),
        videoModels: [
          ...(video ? [video] : []),
          ...workflowModels.filter((m) => m.kind === "video"),
        ],
        videoError,
      });
    } catch (e) {
      res.json({ online: false, checkpoints: [], message: e.message });
    }
  });
  function publicJob(row) {
    const {owner,snapshot,workloadKey,inputAssetIds,payload,environment,recovery,reconnectable,recovering,...job} = row;
    return { ...job, ...jobTimes(job), ...(canRecoverJob(row) && {canRecover:true}) };
  }
  api.post("/jobs/:id/cancel", async (req, res) => {
    res.json(publicJob(await cancelJob(req.params.id)));
  });
  api.post("/jobs/:id/recover", async (req,res) => {
    const job = await recoverJob(req.params.id);
    res.status(job.status === "done" ? 200 : 202).json(publicJob(job));
  });
  api.get("/jobs", async (req, res) => {
    const ids = typeof req.query.ids === "string" ? new Set(req.query.ids.split(",")) : null;
    const rows = (await jobs()).filter(j => !req.query.project || j.project === req.query.project);
    res.json(rows.filter((j, i) => ids ? ids.has(j.id) : i < 100 || j.status === "running").map(publicJob));
  });
  api.get("/projects/:id/nodes/:nodeId/jobs", async (req, res) => {
    const board = await readProject(req.params.id);
    if (!board.nodes.some((n) => n.id === req.params.nodeId))
      throw fail("节点不存在", 404);
    res.json(
      (await jobs())
        .filter(
          (j) =>
            j.project === board.id &&
            j.nodeId === req.params.nodeId &&
            (!req.query.job || j.id === req.query.job),
        )
        .slice(0, 20)
        .map(publicJob),
    );
  });
  api.get("/projects/:id/shots/:shotId/takes", async (req, res) => {
    const board = await readProject(req.params.id);
    if (!board.order.includes(req.params.shotId)) throw fail("分镜不存在", 404);
    res.json(
      (await jobs())
        .filter((j) => j.project === board.id && j.shotId === req.params.shotId)
        .map((j) => ({ ...publicJob(j), snapshot: j.snapshot })),
    );
  });
  api.post("/projects/:id/export", async (req, res) => {
    const board = await readProject(req.params.id);
    if (board.revision !== req.body.revision)
      throw fail("画布有更新，请刷新后再导出", 409);
    const plan = exportPlan(board, await allAssets(), req.body.audioId);
    res
      .status(202)
      .json(
        await enqueue(
          board.id,
          "export",
          board.name + " · 720p MP4",
          plan,
          { inputAssets: plan.frames.map(f => f.asset).concat(plan.audio || []) },
        ),
      );
  });
  api.post("/projects/:id/generate", async (req, res) => {
    const board = await readProject(req.params.id);
    let { checkpoint, shotId } = req.body;
    const shot =
      shotId === undefined
        ? null
        : board.nodes.find((n) => n.id === shotId && n.data.kind === "shot");
    if (shotId !== undefined && !shot) throw fail("分镜不存在", 404);

    const kind = req.body.kind || "image";
    if (!["image", "video", "audio"].includes(kind)) throw fail("生成类型无效");
    const { nodeId } = req.body;
    const canvasNode =
      nodeId === undefined ? null : board.nodes.find((n) => n.id === nodeId);
    if (
      nodeId !== undefined &&
      (!canvasNode || canvasNode.data.kind !== kind || shotId !== undefined)
    )
      throw fail("生成类型与画布节点不匹配");
    if (req.body.environment && req.body.environment !== currentUrl())
      throw fail("ComfyUI 环境已切换，请刷新模型后再生成", 409);
    if (kind === "image" && canvasNode?.data.imageModel)
      checkpoint = canvasNode.data.imageModel;
    const selectedId =
      kind === "image" ? checkpoint : canvasNode?.data[kind + "Model"];
    const restoring = isImageRestoreModel(selectedId);
    const videoSplit = kind === "video" && typeof selectedId === "string" &&
      selectedId.startsWith("studio:video:") ? await discoverSplit() : null;
    const preset =
      selectedId &&
      (await readPresets(videoSplit?.inventory)).find(
        (p) => p.id === selectedId && (p.bindings.kind || "image") === kind,
      );
    const requiresPrompt = !preset || !!preset.bindings.prompt;
    const assets = await allAssets();
    const inputs = canvasNode && canvasInputs(board, canvasNode, assets);
    const shotPrompt =
      restoring || isCharacterCard(selectedId)
        ? ""
        : inputs
          ? inputs.text
          : shot
            ? shot.data.text
            : req.body.prompt;
    if (
      typeof shotPrompt !== "string" ||
      (requiresPrompt && !shotPrompt.trim())
    )
      throw fail("请填写镜头描述");
    const referenceError =
      canvasNode && !preset && mediaReferenceError(canvasNode.data.text);
    if (referenceError) throw fail(referenceError);
    const assetTitle = shot?.data.title || canvasNode?.data.title || shotPrompt.trim().slice(0, 36) || preset?.name || "生成素材";
    const shotCast = (shot ? shot.data.shotCast : req.body.shotCast) ?? "";
    if (typeof shotCast !== "string" || shotCast.length > 1500)
      throw fail("本镜出场角色最多 1500 字");
    let prompt =
      restoring || isCharacterCard(selectedId)
        ? ""
        : shot
          ? composeShot(board, shot.data, kind)
          : inputs
            ? inputs.prompt
            : seriesPrompt(board.series || {}, shotPrompt, shotCast);
    const ratio = canvasNode?.data.canvasRatio || board.series?.ratio || "16:9";
    function generationPrompt(model, resolved) {
      const draft = canvasNode.data[kind + "PromptOptimization"];
      if (!draft || !requiresPrompt || model.hasPrompt === false) return resolved.prompt;
      return effectivePrompt(optimizationContext(canvasNode.data, model, resolved, ratio), draft);
    }
    if (
      (shot || canvasNode || req.body.revision !== undefined) &&
      req.body.revision !== board.revision
    )
      throw fail("画布有更新，请重新打开后生成", 409);
    const duration = Number(
      (shot || canvasNode)?.data.duration ?? req.body.duration ?? 3,
    );
    if (!Number.isFinite(duration) || duration < 1 || duration > 30)
      throw fail("镜头时长无效");
    if (
      typeof prompt !== "string" ||
      (requiresPrompt && !prompt.trim()) ||
      (!(preset && canvasNode) && prompt.length > 8000)
    )
      throw fail("请输入 1 至 8000 字的提示词");
    const split = videoSplit || await discoverSplit();
    const seed = randomInt(0, 2147483647);
    const snapshot = (model, imageId) =>
      shot && {
        shotId,
        title: shot.data.title,
        revision: board.revision,
        kind,
        model,
        seed,
        ratio,
        duration,
        prompt,
        emptyCast: !!shot.data.emptyCast,
        imageId: imageId || "",
        references: referencesForShot(board, shot.data),
        fields: Object.fromEntries(
          ["text", "shotCast", ...Object.keys(shotFields)].map((k) => [
            k,
            shot.data[k] || "",
          ]),
        ),
      };
    async function canvasSize(template, latentType) {
      if (!canvasNode) return undefined;
      if (
        template &&
        !JSON.stringify(template).includes('"{{width}}"') &&
        !JSON.stringify(template).includes('"{{height}}"')
      )
        return undefined;
      const size = outputSize(kind, ratio, canvasNode.data.customSize);
      const error = sizeError(
        size,
        maxSide,
        await dimensionConstraints(latentType),
      );
      if (error) throw fail(error);
      return size;
    }
    const presetDefinitions = preset && await definitionsFor([preset.graph]);
    if (presetDefinitions && selectedId === poseSwapModelId)
      presetDefinitions.QwenImage21Cache = await nodeInfo("QwenImage21Cache").catch(() => null);
    const descriptor = preset && describePreset(preset, presetDefinitions);
    const maxSide = await maxSideFor();
    if (descriptor?.outputSize?.some((v) => v > maxSide))
      throw fail("预设输出超过环境最长边 " + maxSide + " 像素");
    const presetInputs =
      descriptor &&
      canvasNode &&
      resolveWorkflowInputs(inputs, canvasNode, assets, descriptor);
    if (presetInputs?.error) throw fail(presetInputs.error);
    if (presetInputs && presetInputs.prompt.length > 8000)
      throw fail("实际提交的提示词不能超过 8000 字");
    if (kind === "audio") {
      if (!preset || !canvasNode) throw fail("请选择音频节点上的预设工作流");
      const config = bindPreset(
        preset,
        descriptor,
        canvasNode.data.workflowValues,
        [],
        maxSide,
      );
      return res.status(202).json(
        await enqueue(
          board.id,
          kind,
          preset.name,
          {
            projectId: board.id,
            config,
            media: presetInputs.media,
            prompt: generationPrompt(descriptor, presetInputs),
            seed,
            assetTitle,
          },
          { nodeId, inputAssets: Object.values(presetInputs.media).flat() },
        ),
      );
    }
    if (kind === "video") {
      if (selectedId && selectedId !== "studio:default-video" && !preset)
        throw fail("当前环境缺少所选视频工作流，请重新选择");
      const values = selectedId === h3ContinuationModelId
        ? {
            ...canvasNode.data.workflowValues,
            [h3ContinuationFields.secondPrompt]: presetInputs.secondPrompt,
          }
        : canvasNode?.data.workflowValues;
      const config = preset
        ? bindPreset(
            preset,
            descriptor,
            values,
            selectedLoras(descriptor, canvasNode?.data || {}),
            maxSide,
            presetInputs?.selected.length,
            presetInputs?.media,
          )
        : await videoConfig(split);
      if (!config) throw fail("尚未配置视频工作流", 503);
      const dimensions = await canvasSize(
        config.graph,
        "EmptyHunyuanLatentVideo",
      );
      const resolved =
        presetInputs ||
        (canvasNode &&
          resolveVideoInputs(inputs, canvasNode, assets, descriptor || config));
      if (resolved?.error) throw fail(resolved.error);
      if (resolved)
        prompt = generationPrompt(descriptor || { ...config, id: selectedId || "studio:default-video" }, resolved);
      const imageId = resolved
        ? resolved.selected[0]?.assetId
        : req.body.assetId;
      const asset = (await allAssets()).find((a) => a.id === imageId);
      if (config.needsImage && asset?.kind !== "image")
        throw fail("请选择参考图");
      if (shot && req.body.assetId && !config.needsImage)
        throw fail("当前视频工作流不接受该参考图");
      const upscaleGrade = isVideoUpscale(selectedId) ? (selectedId === videoUpscale4kId ? "4K" : "2K") : "";
      const description = upscaleGrade
        ? [descriptor.name, presetInputs.media.video[0]?.name].filter(Boolean).join(" · ")
        : selectedId === h3ContinuationModelId
        ? descriptor.name + " · Seed " + seed + "\n第一段\n" + prompt +
          "\n第二段\n" + presetInputs.secondPrompt
        : "视频工作流 · Seed " + seed + " · " + prompt;
      return res.status(202).json(
        await enqueue(
          board.id,
          "video",
          description,
          {
            projectId: board.id,
            config,
            asset,
            references: resolved?.selected.map((r) => r.asset),
            media: presetInputs?.media,
            sourceAudioAsset: upscaleGrade ? presetInputs.media.video[0] : undefined,
            prompt,
            assetTitle: upscaleGrade ? assetTitle + " · " + upscaleGrade : assetTitle,
            seed,
            ratio,
            duration,
            dimensions,
          },
          { nodeId, modelId: selectedId, take: snapshot(descriptor?.name || config.name, asset?.id),
            inputAssets: presetInputs ? Object.values(presetInputs.media).flat() :
              (resolved?.selected.map(r => r.asset) || (asset ? [asset] : [])) },
        ),
      );
    }
    let config =
      checkpoint === customImageId ? await customWorkflow("image") : null;
    const imageModel = split.catalog.find((m) => m.id === checkpoint);
    if (
      !preset &&
      !config &&
      !imageModel &&
      !(await models()).includes(checkpoint)
    )
      throw fail("当前环境缺少所选图片模型，请重新选择");
    const options = imageOptions(
      descriptor || imageModel,
      canvasNode?.data || {},
    );
    if (preset)
      config = bindPreset(
        preset,
        descriptor,
        canvasNode?.data.workflowValues,
        options.loras,
        maxSide,
      );
    const swapping = selectedId === poseSwapModelId;
    if (swapping) {
      if (!presetInputs) throw fail("请在图片节点里选择人物、姿势或服装参考");
      config = bindPoseSwap(config, presetInputs.roles, presetInputs.prompt, descriptor.poseSwapProfile);
    }
    const accepts = config?.needsImage || imageModel?.reference;
    if (!swapping && !isCharacterCard(selectedId) && inputs?.awaitingImage && accepts)
      throw fail("请先完成上游图片或选择仅使用文字");
    let references = [];
    if (canvasNode) {
      const resolved =
        presetInputs ||
        resolveImages(
          inputs,
          canvasNode,
          assets,
          descriptor || imageModel || { reference: !!config?.needsImage },
        );
      if (resolved.error) throw fail(resolved.error);
      references = resolved.selected.map((r) => r.asset);
      prompt = generationPrompt(descriptor || imageModel || { id: checkpoint }, resolved);
    } else if (req.body.assetId) {
      const a = assets.find((a) => a.id === req.body.assetId);
      if (!accepts || a?.kind !== "image")
        throw fail("当前生图模型或参考图不可用");
      references = [a];
    }
    const asset = references[0];
    if (!swapping && descriptor && references.length !== descriptor.minRefs)
      throw fail("此工作流需要 " + descriptor.minRefs + " 张参考图");
    if (config?.needsImage && !asset) throw fail("请选择参考图");
    const dimensions = await canvasSize(
      config?.graph,
      imageModel?.family === "zImage" ||
        (imageModel?.family === "krea2" && references.length)
        ? "EmptySD3LatentImage"
        : "EmptyLatentImage",
    );
    let restoreLabel = "";
    if (restoring) {
      const sizeLabel = "长边 " + config.graph.size.inputs.largest_size + " px";
      if (selectedId === secondPassRestoreId) {
        restoreLabel = "二采放大 · 重绘 " + Math.round(config.graph.sample.inputs.denoise * 100) + "% · " + sizeLabel;
      } else if (selectedId === relayOriginalRestoreModelId) {
        restoreLabel = descriptor.name + " · " + sizeLabel;
      } else {
        const algorithm = selectedId === relayRestoreModelId ? "RelayVSR · " : "";
        const strength = Math.round(config.graph.blend.inputs.blend_factor * 100);
        restoreLabel = "高清修复 · " + algorithm + "细节增强 " + strength + "% · " + sizeLabel;
      }
    }
    res.status(202).json(
      await enqueue(
        board.id,
        "image",
        restoreLabel || (swapping ? descriptor.name : checkpoint) + " · Seed " + seed + " · " + prompt,
        {
          projectId: board.id,
          checkpoint,
          prompt,
          assetTitle: restoreLabel || assetTitle,
          seed,
          imageModel,
          options,
          references,
          media: presetInputs?.media,
          config,
          ratio,
          dimensions,
          asset,
        },
        { nodeId, modelId: checkpoint, take: snapshot(checkpoint, asset?.id),
          panorama: !restoring && canvasNode?.data.imageTask === "panorama",
          inputAssets: presetInputs ? Object.values(presetInputs.media).flat() : references },
      ),
    );
  });
  api.use((_req, res) => res.status(404).json({ error: "接口不存在" }));
  app.use((err, _req, res, _next) =>
    res.status(err.status || 500).json({
      error:
        err.status === 413
          ? "单个素材不能超过 64 MB"
          : err.status
            ? err.message
            : "服务暂时无法处理请求",
    }),
  );
  return app;
}
