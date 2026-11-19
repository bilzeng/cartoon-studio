import { JobTiming } from "./JobTiming";
import { PromptOptimizer } from "./PromptOptimizer";
import { PromptPresetLibrary } from "./PromptPresetLibrary";
import { optimizationContext, currentOptimization, optimizedNodeChanges } from "../shared/prompt-optimizer";
import { ModelPicker, missingFiles } from "./ModelPicker";
import {
  defaultRestoreSize,
  defaultRestoreStrength,
  restoreModelId,
  isImageRestoreModel,
  relayRestoreModelId,
  relayOriginalRestoreModelId,
  relayRestoreSize,
  restoreSizeKey,
  restoreStrengthKey,
} from "../shared/image-restore";
import { restoreOriginal } from "./RestoreComparison";
import { ImageRestore } from "./ImageRestore";
import { VideoDuration } from "./VideoDuration";
import { PoseSwapEditor } from "./PoseSwap";
import { poseSwapModelId } from "../shared/pose-swap";
import {
  h3ContinuationFields, h3ContinuationModelId, h3ContinuationSizeError, h3VideoModelId,
} from "../shared/h3-video";
import {
  defaultMaxSide,
  videoUpscale2kId,
  outputSize,
  sizeError,
} from "../shared/generation-size";
import { canvasGroups } from "../shared/canvasGroups";
import { GenerationSettings, GenerationHistory } from "./GenerationPanels";
import React, { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  BookImage,
  Check,
  ChevronDown,
  FileText,
  History,
  LoaderCircle,
  ImagePlus,
  Layers,
  ListVideo,
  MapPin,
  MoreHorizontal,
  Columns2,
  Plus,
  SlidersHorizontal,
  Palette,
  ScanLine,
  Shirt,
  Trash2,
  Workflow as WorkflowIcon,
} from "lucide-react";
import { canvasMediaRefs, refLabel } from "./canvasReferences";

import { StyleGallery } from "./ImageComposerTools";
import {
  canvasInputs,
  addCanvasReferences,
  assignPoseSwapReference,
  resolveImages,
  resolveVideoInputs,
  resolveWorkflowInputs,
  workflowNeeds,
  mediaReferenceError,
  availableStyles,
} from "../shared/canvas";
import { kinds } from "../shared/studio";
import { api, uploadAsset } from "./client";
import { AssetPreview, Media } from "./ui";

const MediaPrompt = lazy(() =>
  import("./ImagePrompt").then((module) => ({ default: module.ImagePrompt })),
);

export function NodeComposer({
  board,
  node,
  assets,
  engine,
  edit,
  update,
  link,
  unlink,
  open,
  onSplit,
  onGenerateShot,
  openRestoreNode,
  openPoseSwapNode,
  onMediaSubmission,
  droppingImages,
  refresh,
  flush,
  notify,
}) {
  const [previewAsset, setPreviewAsset] = useState(null);
  const [panel, setPanel] = useState(""),
    [jobs, setJobs] = useState([]),
    [processing, setBusy] = useState(false),
    [tick, poll] = useState(0),
    [error, showError] = useState("");
  const busy = processing || droppingImages;
  const file = useRef(null);
  const settingsTrigger = useRef(null);
  const modelTrigger = useRef(null);
  const composer = useRef(null);
  const { data, id } = node,
    kind = data.kind,
    generated = ["image", "video", "audio"].includes(kind);
  const inputs = canvasInputs(board, node, assets);
  const incoming = new Map(
    board.edges.filter((e) => e.target === id).map((e) => [e.source, e]),
  );
  const groups = [...canvasGroups(board.nodes).values()];
  const groupSources = new Set(
    groups
      .filter((g) => incoming.has(g.id))
      .flatMap((g) => g.members.map((n) => n.id)),
  );
  const imageModel = data.imageModel
    ? engine?.imageModels?.find((m) => m.id === data.imageModel)
    : engine?.imageModels?.find((m) => !m.workflow) ||
      engine?.imageModels?.find((m) => m.id !== poseSwapModelId && !missingFiles(m).length);
  const videos =
    engine?.videoModels ||
    (engine?.video ? [{ ...engine.video, id: "studio:default-video" }] : []);
  const videoModel = data.videoModel
    ? videos.find((m) => m.id === data.videoModel)
    : videos.find((m) => !m.workflow) ||
      videos.find((m) => m.baseModel && (inputs.reference || !m.needsImage)) ||
      videos.find((m) => m.id !== h3ContinuationModelId && m.hasPrompt !== false && !missingFiles(m).length);
  const audioModels = engine?.audioModels || [];
  const audioModel = data.audioModel
    ? audioModels.find((m) => m.id === data.audioModel)
    : audioModels.find((m) => !missingFiles(m).length);
  const model =
    kind === "image" ? imageModel : kind === "video" ? videoModel : audioModel;
  const restoring = kind === "image" && isImageRestoreModel(data.imageModel);
  const swapping = kind === "image" && model?.id === poseSwapModelId;
  const poseSwap = engine?.imageModels?.find((m) => m.id === poseSwapModelId);
  const upscalingVideo = kind === "video" && data.videoModel === videoUpscale2kId;
  const continuingVideo = kind === "video" && model?.id === h3ContinuationModelId;
  const originalRestore = kind === "image" && data.imageModel === relayOriginalRestoreModelId;
  const preferredRestore = [relayOriginalRestoreModelId, relayRestoreModelId, restoreModelId]
    .map((id) => engine?.imageModels?.find((m) => m.id === id))
    .find((m) => m && !missingFiles(m).length);
  const resolved = model?.workflow
    ? resolveWorkflowInputs(inputs, node, assets, model)
    : kind === "video"
      ? resolveVideoInputs(inputs, node, assets, videoModel)
      : resolveImages(inputs, node, assets, imageModel);
  const promptRefs = canvasMediaRefs(resolved, inputs, data, assets);
  const unsupportedRef = !model?.workflow && mediaReferenceError(data.text);
  const missingStyle = data.imageLoras?.some(
    (l) => !availableStyles(model, data.workflowValues).includes(l.name),
  );
  const stale =
    !model && ["audio", "video"].includes(kind)
      ? "请选择或导入" + kinds[kind] + "工作流"
      : missingFiles(model).length
        ? "请打开模型与工作流，为此预设匹配当前环境的模型文件。"
        : missingStyle && (kind === "image" || kind === "video")
          ? "请在风格广场移除当前模型无法加载的 LoRA"
          : kind === "image" &&
          (engine && !engine.online
            ? engine.message || "无法连接 ComfyUI，请检查环境设置"
            : data.imageModel && !imageModel
              ? "当前环境缺少原模型，请重选图片模型"
              : data.imageVae && !imageModel?.vaes?.includes(data.imageVae)
                ? "请选择当前环境中的 VAE"
                : "");

  const acceptsRef =
    model?.reference ?? model?.needsImage;
  const waitingForRef = !swapping && inputs.awaitingImage && (kind === "image" ? acceptsRef : model?.needsImage);
  const ratio = data.canvasRatio || board.series.ratio;
  const optimization = generated && model && !restoring && !upscalingVideo && model.hasPrompt !== false
    ? optimizationContext(data, model, resolved, ratio, { forEditor: true }) : null;
  const restoredAsset = restoring && assets.find(a => a.id === data.assetId);
  const canCompare = restoreOriginal(restoredAsset, assets);
  const draftKey = kind + "PromptOptimization";
  const adopted = data[draftKey];
  const maxSide = engine?.maxSide ?? defaultMaxSide;
  const restoreSizeField = (m) => m?.fields?.find((f) => f.key === restoreSizeKey);
  const restoreSizeLimit = (m) => Math.min(maxSide, restoreSizeField(m)?.max ?? maxSide);
  const initialRestoreSize = (m, id = m?.id) => Math.min(
    restoreSizeLimit(m),
    restoreSizeField(m)?.value ??
      (id === relayRestoreModelId || id === relayOriginalRestoreModelId ? relayRestoreSize : defaultRestoreSize),
  );
  const restoreLimit = restoreSizeLimit(imageModel);
  const restoreSize =
    data.workflowValues?.[restoreSizeKey] ?? initialRestoreSize(imageModel, data.imageModel);
  const limits =
    engine?.limits?.[
      (imageModel?.family === "zImage" ||
        (imageModel?.family === "krea2" && resolved.selected.length)) &&
      kind === "image"
        ? "sd3"
        : kind
    ];
  const dimensions = ["image", "video"].includes(kind)
    ? outputSize(kind, ratio, data.customSize)
    : [];
  const workflowValue = (key) =>
    data.workflowValues?.[key] ?? model?.fields?.find((f) => f.key === key)?.value;
  const continuationSizeError = continuingVideo && h3ContinuationSizeError(
    workflowValue(h3ContinuationFields.resolution),
    workflowValue(h3ContinuationFields.aspect),
    maxSide,
  );
  const invalidSize =
    restoring &&
    (!Number.isInteger(restoreSize) ||
      restoreSize < 1 ||
      restoreSize > restoreLimit)
      ? "输出长边须为 1 到 " + restoreLimit + " 之间的整数"
      : continuationSizeError || (["video", "image"].includes(kind) &&
        (model?.workflow && !swapping
          ? model.outputSize?.some((v) => v > maxSide) &&
            "预设输出超过当前环境的最长边上限"
          : model?.canSize === false
            ? ""
            : sizeError(dimensions, maxSide, limits)));
  const set = (props) => update(id, adopted && "text" in props
    ? { ...props, [draftKey]: undefined } : props);
  const setWorkflowValue = (key, value) =>
    set({ workflowValues: { ...data.workflowValues, [key]: value } });
  function chooseModel(m) {
    if (m.id === data[kind + "Model"]) return;
    const restore = isImageRestoreModel(m.id);
    const continuationAspect = m.id === h3ContinuationModelId &&
      m.fields?.find((f) => f.key === h3ContinuationFields.aspect)?.choices.includes(ratio);
    set({
      [kind + "Model"]: m.id,
      canvasRefIds: undefined,
      selectedMediaRefs: undefined,
      imageVae: "",
      imageLoras: (data.imageLoras || []).filter((l) =>
        m.loras?.includes(l.name),
      ),
      workflowValues: restore
        ? { [restoreSizeKey]: initialRestoreSize(m) }
        : continuationAspect ? { [h3ContinuationFields.aspect]: ratio } : {},
      ...(restore
        ? {
            canvasRef: data.canvasRef === "upload" && data.guideAssetId ? "upload"
              : inputs.guides.find((n) => n.id === data.canvasRef)?.id || inputs.guides[0]?.id || "",
          }
        : m.workflow
          ? { canvasRef: m.maxRefs ? "" : "none" }
          : {}),
      ...(m.id === poseSwapModelId && !data.canvasRatio && { canvasRatio: "9:16" }),
    });
    setPanel("");
  }
  function startRestore() {
    if (!preferredRestore) {
      showError(
        !engine?.online
          ? "请先连接 ComfyUI 环境"
          : "当前环境缺少高清修复所需的节点或放大模型，请检查「模型与工作流」。",
      );
      return;
    }
    showError("");
    if (data.assetId)
      openRestoreNode(node, preferredRestore.id, {
        [restoreSizeKey]: initialRestoreSize(preferredRestore),
      });
    else chooseModel(preferredRestore);
  }
  function startPoseSwap() {
    if (missingFiles(poseSwap).length) {
      modelTrigger.current?.click();
      return;
    }
    if (data.assetId) openPoseSwapNode(node);
    else chooseModel(poseSwap);
  }
  function assignPoseReference(role, selection) {
    edit((b) => assignPoseSwapReference(b, id, role, selection, assets));
  }
  const menu = (name) => setPanel((p) => (p === name ? "" : name));
  useEffect(() => {
    if (!generated) return;
    let active = true,
      timer;
    const pull = async () => {
      try {
        await flush();
        if (!active) return;
        const rows = await api(
          "/projects/" + board.id + "/nodes/" + id + "/jobs",
        );
        if (!active) return;
        setJobs(rows);
        if (rows[0]?.status === "done") await refresh();
        if (active && rows.some((j) => j.status === "running"))
          timer = setTimeout(pull, 1500);
      } catch (e) {
        if (active) showError(e.message);
      }
    };
    pull();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [board.id, id, tick, generated, refresh, flush]);
  async function generate() {
    onMediaSubmission(id, true);
    setBusy(true);
    showError("");
    try {
      if (model && !data[kind + "Model"]) set({ [kind + "Model"]: model.id });
      const revision = await flush();
      const ticket = await api("/projects/" + board.id + "/generate", "POST", {
        nodeId: id,
        kind,
        revision,
        checkpoint: imageModel?.id,
        environment: engine?.environment,
      });
      set({
        pendingCanvasJob: ticket.id,
        pendingMediaSource: data.assetId || "",
      });
      await flush();
      setPanel("");
      poll((n) => n + 1);
    } catch (e) {
      showError(e.message);
    } finally {
      onMediaSubmission(id, false);
      setBusy(false);
    }
  }
  async function uploadReferences(files, selectKind) {
    if (!files.length) return;
    setBusy(true);
    showError("");
    const added = [];
    let duplicates = 0;
    try {
      for (const f of files) {
        if (f.size > 64 * 1024 * 1024) throw Error(f.name + " 超过 64 MB");
        const asset = await uploadAsset(f, board.id);
        if (!["image", "video", "audio"].includes(asset.kind))
          throw Error("请选择图片、视频或音频素材");
        if (asset.duplicate) duplicates++;
        if (!added.some(a => a.id === asset.id)) added.push(asset);
      }
    } catch (e) {
      showError(e.message);
    } finally {
      try {
        if (added.length) {
          edit((b) => {
            const target = b.nodes.find((n) => n.id === id);
            if (!target) throw Error("生成节点已移除，上传的图片已存入素材库");
            const placed = addCanvasReferences(b, target, added);
            b = placed.board;
            const newIds = placed.references.filter((ref) => ref.data.kind === selectKind).map((ref) => ref.id);
            const next = { ...target.data, canvasRef: selectKind && selectKind !== "image" ? target.data.canvasRef : "" };
            if (newIds.length) {
              const image = selectKind === "image";
              const selected = image ? resolved.selected : resolved.mediaReferences[selectKind].selected;
              const limit = model.mediaSlots[selectKind];
              const ids = [...selected.map((r) => r.id), ...newIds].slice(0, limit);
              // Mentions stay selected through the prompt; only store the additional choices.
              const pinned = image
                ? selected.filter((r) => new RegExp("@图" + r.number + "(?!\\d)").test(target.data.text))
                : selected.filter((r) => resolved.mediaReferences[selectKind].tokens.includes(r.number));
              const manual = ids.filter((id) => !pinned.some((r) => r.id === id));
              if (image) next.canvasRefIds = manual;
              else next.selectedMediaRefs = { ...next.selectedMediaRefs, [selectKind]: manual };
            }
            return {
              ...b,
              nodes: b.nodes.map((n) =>
                n.id === id ? { ...n, data: next } : n,
              ),
            };
          });
          await refresh();
          if (duplicates) notify(duplicates === 1 ? "素材已存在，已使用库中素材" : duplicates + " 个文件已在素材库中，已复用");
        }
      } catch (e) {
        showError(e.message);
      }
      setBusy(false);
      if (file.current) file.current.value = "";
    }
  }
  async function upload(f) {
    if (!f) return;
    setBusy(true);
    showError("");
    try {
      if (f.size > 64 * 1024 * 1024) throw Error("单个素材最多 64 MB");
      const a = await uploadAsset(f, board.id);
      await refresh();
      if (a.kind === "image" && generated)
        set({
          guideAssetId: a.id,
          canvasRef: "upload",
        });
      else if (
        kind === a.kind ||
        (kind === "shot" && ["video", "image"].includes(a.kind))
      )
        set({ assetId: a.id });
      else throw Error("素材已入库，请选择与节点匹配的文件");
      if (a.duplicate) notify("素材已存在，已使用库中素材");
    } catch (e) {
      showError(e.message);
    } finally {
      setBusy(false);
      if (file.current) file.current.value = "";
    }
  }
  const pending = jobs.some((j) => j.status === "running"),
    latest = jobs[0];
  const runningLabel = /^正在(重试)?上传/.test(latest?.detail)
    ? latest.detail
    : /^(已送入 ComfyUI 队列|ComfyUI 正在执行|正在下载生成结果)/.exec(latest?.detail)?.[0] || "正在生成";
  const guide = assets.find((a) => a.id === inputs.reference);
  const mark = data.imageMark?.assetId === guide?.id ? data.imageMark : null;
  const result = assets.find((a) => a.id === latest?.assetId);
  const toggle = (name, Icon, label) => (
    <button
      type="button"
      className={panel === name ? "active" : ""}
      aria-expanded={panel === name}
      onClick={() => menu(name)}
    >
      <Icon size={14} />
      {label}
    </button>
  );
  return (
    <div
      ref={composer}
      className="node-composer nodrag nopan nowheel"
      onKeyDown={(e) => {
        if (
          e.key === "Escape" &&
          panel &&
          !["settings", "versions", "prompts"].includes(panel)
        ) {
          e.stopPropagation();
          setPanel("");
        }
      }}
    >
      <div className="composer-chips">
        {!swapping && ["image", "video", "shot", "audio"].includes(kind) && (
          <button onClick={() => file.current.click()} disabled={busy}>
            <Plus size={15} />
            上传
          </button>
        )}
        <input
          type="file"
          ref={file}
          hidden
          accept={restoring ? "image/*" : generated ? "image/*,video/*,audio/*" : "image/*,video/*"}
          multiple={generated}
          onChange={(e) =>
            generated &&
            (kind === "image" || model?.workflow || e.target.files.length > 1)
              ? uploadReferences(Array.from(e.target.files))
              : upload(e.target.files[0])
          }
        />
        {toggle(
          "links",
          Layers,
          "画布参考" +
            (inputs.upstream.length ? " · " + inputs.upstream.length : ""),
        )}
        {canCompare && <button type="button" onClick={() => setPreviewAsset(restoredAsset)}>
          <Columns2 size={14} /> 对比原图
        </button>}
        {kind === "image" &&
          !restoring &&
          (data.assetId || inputs.guides.length > 0 || data.guideAssetId) && (
            <button
              onClick={startRestore}
              disabled={!engine || busy || pending || !!data.pendingCanvasJob}
            >
              <ScanLine size={14} /> 高清修复
            </button>
          )}
        {kind === "image" && poseSwap && !swapping && !restoring && (
          <button type="button" onClick={startPoseSwap} disabled={busy || pending || !!data.pendingCanvasJob}>
            <Shirt size={14} /> 姿势换装
          </button>
        )}
        {kind === "video" && data.assetId && !upscalingVideo && (
          <button
            onClick={() => {
              const preset = videos.find(m => m.id === videoUpscale2kId);
              if (!preset || missingFiles(preset).length)
                return showError("当前环境缺少 RelayVSR 视频超分节点或模型，请检查「模型与工作流」。");
              showError("");
              openRestoreNode(node);
            }}
            disabled={busy || pending || !!data.pendingCanvasJob}
          >
            <ScanLine size={14} /> 放大到 2K
          </button>
        )}
        {generated && !restoring && !upscalingVideo && !swapping && (
          <button onClick={() => menu("mark")} aria-expanded={panel === "mark"}>
            <MapPin size={14} />
            标记
          </button>
        )}
        {generated &&
          !restoring && !upscalingVideo && !swapping &&
          toggle(
            "style",
            Palette,
            "风格" +
              (data.imageLoras?.length ? " · " + data.imageLoras.length : ""),
          )}
        {!restoring && !upscalingVideo && !swapping && (!generated || model?.hasPrompt !== false) && (
          <button type="button" aria-haspopup="dialog" aria-expanded={panel === "prompts"}
            onClick={() => menu("prompts")}>
            <FileText size={14} />预设提示词
          </button>
        )}
        {optimization && <PromptOptimizer
          context={optimization} source={data.text}
          inputError={resolved.error || unsupportedRef || (!data.text.trim() && "请先填写" + kinds[kind] + "描述")}
          onStart={() => { showError(""); setPanel(""); }}
          onError={showError} notify={notify}
          apply={(text) => set(optimizedNodeChanges(data, optimization, resolved, text))}
        />}
        {kind === "shot" && (
          <button onClick={() => open("refs")}>
            <BookImage size={14} />
            设定引用
          </button>
        )}
        <button
          className="chip-more"
          onClick={() => menu("more")}
          aria-label="节点操作"
        >
          <MoreHorizontal size={17} />
        </button>
      </div>
      {panel === "style" && (kind === "image" || kind === "video") && (
        <StyleGallery
          projectId={board.id}
          model={model}
          chooseVideoModel={kind === "video" ? () => {
            setPanel("");
            requestAnimationFrame(() => modelTrigger.current?.click());
          } : undefined}
          data={data}
          set={set}
          engine={engine}
          close={() => setPanel("")}
        />
      )}
      {previewAsset && <AssetPreview asset={previewAsset} assets={assets} projectId={board.id} close={() => setPreviewAsset(null)} />}
      {panel &&
        !["settings", "versions", "prompts"].includes(panel) &&
        !(panel === "style" && (kind === "image" || kind === "video")) && (
          <div className="composer-pop">
            {panel === "links" && (
              <>
                <strong>画布参考</strong>
                {groups
                  .filter((g) => g.key !== data.canvasGroup)
                  .map((g) => {
                    const edge = incoming.get(g.id);
                    return (
                      <button
                        key={g.id}
                        aria-pressed={!!edge}
                        onClick={() =>
                          edge ? unlink(edge.id) : link(g.id, id)
                        }
                      >
                        {edge ? <Check size={14} /> : <Plus size={14} />}{" "}
                        <Layers size={14} /> {g.name} · {g.members.length}{" "}
                        个节点
                      </button>
                    );
                  })}
                {board.nodes
                  .filter((n) => n.id !== id)
                  .map((n) => {
                    const edge = incoming.get(n.id);
                    const viaGroup = groupSources.has(n.id);
                    const ref = promptRefs.refs.find((r) => r.id === n.id);
                    const media = ref?.asset || assets.find(a => a.id === n.data.assetId);
                    const label = ref ? refLabel(ref.asset.kind, ref.number) : kinds[n.data.kind] + " · " + n.data.title;
                    return (
                      <div className="reference-link-row" key={n.id}>
                        {media && (
                          <button className="link-thumb" aria-label={"预览素材 " + label} title={"预览 " + media.name}
                            onClick={() => setPreviewAsset(media)}>
                            <Media asset={media} />
                          </button>
                        )}
                        <button disabled={viaGroup && !edge} aria-pressed={!!edge || viaGroup}
                          onClick={() => edge ? unlink(edge.id) : link(n.id, id)}>
                          {edge || viaGroup ? <Check size={14} /> : <Plus size={14} />}
                          {label}
                          {viaGroup && <small>来自 {n.data.canvasGroupName || n.data.canvasGroup}</small>}
                        </button>
                      </div>
                    );
                  })}
                {board.nodes.length === 1 && (
                  <small>从节点左侧加号连接上游素材。</small>
                )}
              </>
            )}
            {panel === "mark" &&
              (guide ? (
                <>
                  <span>点选参考图上的位置，填写该处的修改要求。</span>
                  <button
                    className="mark-surface"
                    title="在参考图上添加标记"
                    onClick={(e) => {
                      const r = e.currentTarget.getBoundingClientRect();
                      set({
                        imageMark: {
                          assetId: guide.id,
                          x:
                            e.detail === 0
                              ? 50
                              : Math.round(
                                  ((e.clientX - r.left) / r.width) * 100,
                                ),
                          y:
                            e.detail === 0
                              ? 50
                              : Math.round(
                                  ((e.clientY - r.top) / r.height) * 100,
                                ),
                          note: mark?.note || "",
                        },
                      });
                    }}
                  >
                    <img src={guide.url} alt={guide.name} />
                    {mark && (
                      <MapPin
                        size={18}
                        style={{ left: mark.x + "%", top: mark.y + "%" }}
                      />
                    )}
                  </button>
                  {mark && (
                    <label>
                      标记说明
                      <input
                        maxLength={500}
                        value={mark.note}
                        onChange={(e) =>
                          set({ imageMark: { ...mark, note: e.target.value } })
                        }
                      />
                      <button onClick={() => set({ imageMark: null })}>
                        清除
                      </button>
                    </label>
                  )}
                </>
              ) : (
                <small>上传或接入一张参考图后可进行位置标记。</small>
              ))}
            {panel === "style" && (
              <label>
                本节点画风
                <input
                  value={data.styleHint || ""}
                  maxLength={1500}
                  placeholder="例如：水墨、淡彩、细线描边"
                  onChange={(e) => set({ styleHint: e.target.value })}
                />
              </label>
            )}
            {panel === "more" && (
              <>
                <label>
                  节点名称
                  <input
                    maxLength={120}
                    value={data.title}
                    onChange={(e) => set({ title: e.target.value })}
                  />
                </label>
                {["image", "video", "audio", "shot"].includes(kind) && (
                  <button onClick={() => open("choose")}>
                    <ImagePlus size={14} />
                    选择素材
                  </button>
                )}
                <button onClick={() => open("delete")}>
                  <Trash2 size={14} />
                  删除节点
                </button>
              </>
            )}
          </div>
        )}
      {panel === "prompts" && (
        <PromptPresetLibrary kind={kind} verbatim={model?.verbatim} value={data.text}
          close={() => setPanel("")} apply={(text) => {
            set({ text });
            setPanel("");
          }} />
      )}
      {panel === "settings" && (
        <GenerationSettings
          anchor={settingsTrigger}
          close={() => setPanel("")}
          {...{
            kind,
            data,
            set,
            model,
            ratio,
            resolved,
            inputs,
            maxSide,
            limits,
            busy,
            error,
            uploadReferences,
          }}
          chooseCanvas={() => setPanel("links")}
          editPrompt={() => {
            setPanel("");
            requestAnimationFrame(() =>
              composer.current
                ?.querySelector('[role="textbox"], textarea')
                ?.focus(),
            );
          }}
        />
      )}
      {panel === "versions" && (
        <GenerationHistory
          {...{ jobs, assets, data }}
          projectId={board.id}
          close={() => setPanel("")}
          apply={(assetId) => {
            set({ assetId });
            setPanel("");
          }}
        />
      )}
      {generated && model?.workflow && !restoring && !swapping && (
        <div className="workflow-brief">
          <WorkflowIcon size={14} />
          <span>{continuingVideo ? "两段共用一张参考图" : workflowNeeds(model)}</span>
          {model.id !== h3VideoModelId && model.controls?.length > 0 && (
            <button onClick={() => menu("settings")}>调整参数</button>
          )}
        </div>
      )}
      {restoring ? (
        <ImageRestore
          refs={resolved.refs}
          source={resolved.selected.length === 1 ? resolved.selected[0] : null}
          size={restoreSize}
          original={originalRestore}
          strength={originalRestore ? undefined : data.workflowValues?.[restoreStrengthKey] ??
            (data.imageModel === relayRestoreModelId ? 1 : defaultRestoreStrength)}
          limit={restoreLimit}
          onSource={(canvasRef) => set({ canvasRef })}
          onSize={(size) => setWorkflowValue(restoreSizeKey, size)}
          onStrength={(value) => setWorkflowValue(restoreStrengthKey, value)}
        />
      ) : upscalingVideo ? (
        <div className="workflow-brief">{resolved.media?.video?.[0]?.name || "请选择一段源视频"} · 等比放大，保留原帧率和声音</div>
      ) : swapping ? (
        <PoseSwapEditor roles={resolved.roles} refs={resolved.refs}
          projectId={board.id} disabled={busy || pending} notes={data.text}
          setNotes={(text) => set({ text })} assign={assignPoseReference}
          {...{ assets, refresh, notify }} />
      ) : generated ? (
        <Suspense
          fallback={
            <div className="prompt-loading" aria-busy="true">
              载入提示词…
            </div>
          }
        >
          <MediaPrompt
            key={model?.promptLabel || kind}
            projectId={board.id}
            promptLabel={model?.hasPrompt && model.promptLabel}
            {...{
              data,
              set,
              assets,
              resolved: promptRefs,
              unlink,
              incoming,
              groupSources,
            }}
          />
        </Suspense>
      ) : (
        <textarea
          aria-label={kinds[kind] + "节点提示词"}
          rows={2}
          maxLength={40000}
          placeholder={
            kind === "script"
              ? "写下剧本，每行一个镜头…"
              : "写下" + kinds[kind] + "的内容…"
          }
          value={data.text}
          onChange={(e) => set({ text: e.target.value })}
        />
      )}
      {continuingVideo && (
        <section className="continuation-editor" aria-label="两段续接">
          <div className="continuation-timing">
            <span>第一段时长</span>
            <VideoDuration model={model} data={data} set={set} label="第一段时长" />
          </div>
          <div className="continuation-timing">
            <span>第二段 · 接续动作</span>
            <VideoDuration model={model} data={data} set={set} label="第二段时长"
              fieldKey={h3ContinuationFields.secondDuration} />
          </div>
          <textarea
            aria-label="第二段 · 接续动作"
            rows={2}
            maxLength={8000}
            placeholder="从第一段结束的姿势和机位接着写…"
            value={data.workflowValues?.[h3ContinuationFields.secondPrompt] ?? ""}
            onChange={(e) => setWorkflowValue(h3ContinuationFields.secondPrompt, e.target.value)}
          />
        </section>
      )}
      {adopted && optimization && <small className="opt-applied">{currentOptimization(optimizationContext(data, model, resolved, ratio), adopted)
        ? "本次生成使用优化稿 · " + adopted.modelName : "场景或素材已变化，本次生成使用原文"}</small>}
      {generated && latest && (
        <div className="generation-result">
          {latest.status === "running" ? (
            <LoaderCircle size={15} className="generation-spin" />
          ) : result ? (
            <Media asset={result} />
          ) : null}
          <div className="generation-result-info">
            <span className="generation-status" aria-live="polite" title={latest.detail} data-status={latest.status}>
              {latest.status === "running"
                ? runningLabel
                : latest.status === "failed"
                  ? (latest.detail || "最近一次生成失败")
                  : result?.id && result.id === data.assetId
                    ? "画布正在使用此版"
                    : "新版本已生成"}
            </span>
            <JobTiming job={latest} showSteps={kind === "video"} />
          </div>
          <button onClick={() => menu("versions")} aria-haspopup="dialog">
            <History size={14} />
            生成记录 <b>{jobs.length}</b>
          </button>
        </div>
      )}
      {generated && waitingForRef && (
        <small>
          上游图片尚无结果。请先生成上游图片，或上传参考图。
        </small>
      )}
      {generated &&
        model &&
        !acceptsRef &&
        inputs.upstream.some((n) => n.data.kind === "image") && (
          <small>当前工作流没有图片输入。</small>
        )}
      {generated &&
        engine &&
        (stale || invalidSize || resolved.error || unsupportedRef) && (
          <small role="alert">
            {stale || invalidSize || resolved.error || unsupportedRef}
          </small>
        )}
      {error && <small role="alert">{error}</small>}
      <footer className={generated ? "generation-footer" : undefined}>
        {generated ? (
          <>
            <ModelPicker
              triggerRef={modelTrigger}
              {...{ kind, engine, model, notify }}
              models={
                kind === "image"
                  ? engine?.imageModels || []
                  : kind === "video"
                    ? videos
                    : audioModels
              }
              onChoose={chooseModel}
            />
            {!restoring && (
              <button
                ref={settingsTrigger}
                className="settings-trigger"
                onClick={() => menu("settings")}
                aria-haspopup="dialog"
                aria-expanded={panel === "settings"}
              >
                <SlidersHorizontal size={14} />
                生成设置
                {kind !== "audio" &&
                  !model?.workflow &&
                  model?.canSize !== false && (
                    <span>
                      {data.customSize ? dimensions.join("×") : ratio}
                    </span>
                  )}
                <ChevronDown size={12} />
              </button>
            )}
            <div className="generation-actions">
              {kind === "video" && model && !upscalingVideo && !continuingVideo && (
                <VideoDuration key={model.id} {...{ model, data, set }} />
              )}
              <button
                className="solid run-node"
                title="生成到当前节点"
                disabled={
                  busy ||
                  pending ||
                  !model ||
                  invalidSize ||
                  stale ||
                  resolved.error ||
                  unsupportedRef ||
                  (model.hasPrompt !== false && !inputs.text.trim()) ||
                  waitingForRef ||
                  (!swapping && model.needsImage && !inputs.reference)
                }
                onClick={generate}
              >
                {pending || busy ? (
                  <LoaderCircle size={15} className="generation-spin" />
                ) : (
                  <ArrowUp size={15} />
                )}
                {pending
                  ? "生成中"
                  : busy
                    ? "处理中"
                    : restoring
                      ? "开始修复"
                      : kind === "image"
                        ? "生成图片"
                        : kind === "video"
                          ? (upscalingVideo ? "开始放大" : "生成视频")
                          : "生成音频"}
              </button>
            </div>
          </>
        ) : kind === "shot" ? (
          <>
            <button onClick={() => onGenerateShot(node, "image")}>
              分镜生图
            </button>
            <button onClick={() => onGenerateShot(node, "video")}>
              分镜生视频
            </button>
            <button onClick={() => open("takes")}>本镜候选</button>
          </>
        ) : kind === "script" ? (
          <button onClick={onSplit}>
            <ListVideo size={15} />
            拆成分镜
          </button>
        ) : (
          <small>{kinds[kind]}节点</small>
        )}
      </footer>
    </div>
  );
}
