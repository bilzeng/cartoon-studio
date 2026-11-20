import { canvasGroups, validCanvasEndpoints } from "../shared/canvasGroups.js";
import { referenceTypes, shotFields } from "../shared/storyboard.js";
import { defaultSeries, ratios } from "../shared/series.js";
import { allAssets, findBoard, listBoardFiles, persistBoard } from "./project-files.mjs";
export { allAssets, assetPath, storeAsset } from "./project-files.mjs";
import { hostname } from "node:os";
import { validStage } from "../shared/director-stage.js";
import { kinds } from "../shared/studio.js";
import { poseSwapRoles } from "../shared/pose-swap.js";
import {
  root,
  readJson,
  editJson,
  assetFile,
  jobFile,
} from "./files.mjs";
export { root };

export function fail(message, status = 400) {
  return Object.assign(new Error(message), { status });
}
export const now = () => new Date().toISOString();
export async function jobs() {
  const rows = await readJson(jobFile, []);
  let position = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].status === "running" && rows[i].phase === "waiting")
      rows[i].queuePosition = ++position;
  }
  // Older successful jobs recorded the result asset's creation but no finish time.
  if (!rows.some(j => j.status === "done" && !j.finishedAt && j.assetId)) return rows;
  const createdByAsset = new Map((await readJson(assetFile, [])).map(a => [a.id, a.created]));
  return rows.map(j => j.status === "done" && !j.finishedAt && createdByAsset.has(j.assetId)
    ? { ...j, finishedAt: createdByAsset.get(j.assetId) } : j);
}
export const changeJobs = (fn) =>
  editJson(jobFile, [], (items) => {
    fn(items);
    return items;
  });
function abandoned(job) {
  if (job.status !== "running" || (job.phase === "waiting" && job.payload)) return false;
  if (!job.owner || job.owner.host !== hostname()) return true;
  try {
    process.kill(job.owner.pid, 0);
    return false;
  } catch (e) {
    return e.code === "ESRCH";
  }
}
if ((await jobs()).some(abandoned))
  await changeJobs((items) => {
    for (const j of items)
      if (abandoned(j))
        Object.assign(j, {
          status: "failed",
          detail: "服务已重启，请重新提交任务",
        });
  });
export async function readProject(id) {
  const { board } = await findBoard(id);
  return { ...board, referenceCards: board.referenceCards || [], series: { ...defaultSeries, ...board.series } };
}
export async function listProjects() {
  return (await listBoardFiles()).map(e => e.board)
    .sort((a, b) => b.updated.localeCompare(a.updated))
    .map(({ id, name, updated, nodes, order }) => {
      const coverId = nodes.find(n => n.data.assetId && ["image", "shot"].includes(n.data.kind))?.data.assetId;
      return { id, name, updated, coverId, count: order.length };
    });
}
export const saveProject = persistBoard;
export async function validateBoard(board) {
  if (!board || typeof board !== "object") throw fail("画布文件无效");
  const { name, nodes, edges, order } = board;
  const series = { ...defaultSeries, ...board.series };
  if (
    !Object.hasOwn(ratios, series.ratio) ||
    [series.style, series.cast, series.world].some(
      (t) => typeof t !== "string" || t.length > 1500,
    )
  )
    throw fail("漫剧设定或画幅无效");
  if (
    typeof name !== "string" ||
    !name.trim() ||
    name.length > 100 ||
    !Array.isArray(nodes) ||
    nodes.length > 250 ||
    !Array.isArray(edges) ||
    edges.length > 1000 ||
    !Array.isArray(order)
  )
    throw fail("项目名称或画布数据无效，每个项目最多 250 个节点");
  const ids = new Set(),
    shotIds = new Set(),
    assets = new Map((await allAssets()).map((a) => [a.id, a]));
  if (series.refAssetId && assets.get(series.refAssetId)?.kind !== "image")
    throw fail("剧集参考图不可用");
  const referenceCards =
    board.referenceCards === undefined ? [] : board.referenceCards;
  if (!Array.isArray(referenceCards) || referenceCards.length > 500)
    throw fail("每集最多 500 张设定卡");
  const cardTypes = new Map();
  for (const card of referenceCards) {
    if (
      !card ||
      typeof card.id !== "string" ||
      !card.id ||
      card.id.length > 100 ||
      cardTypes.has(card.id) ||
      !Object.hasOwn(referenceTypes, card.type) ||
      typeof card.name !== "string" ||
      !card.name.trim() ||
      card.name.length > 100 ||
      typeof card.description !== "string" ||
      card.description.length > 1500 ||
      (card.imageId && assets.get(card.imageId)?.kind !== "image")
    )
      throw fail("设定卡名称、说明或参考图无效");
    cardTypes.set(card.id, card.type);
  }
  for (const n of nodes) {
    const d = n?.data;
    if (
      typeof n?.id !== "string" ||
      !n.id ||
      ids.has(n.id) ||
      !Object.hasOwn(kinds, d?.kind) ||
      !Number.isFinite(n.position?.x) ||
      !Number.isFinite(n.position?.y)
    )
      throw fail("节点或坐标无效");
    if (
      typeof d.title !== "string" ||
      d.title.length > 120 ||
      typeof d.text !== "string" ||
      d.text.length > 40000 ||
      (d.shotCast !== undefined &&
        (typeof d.shotCast !== "string" || d.shotCast.length > 1500)) ||
      !Number.isFinite(d.duration) ||
      d.duration < 1 ||
      d.duration > 30
    )
      throw fail("节点内容或镜头时长无效");
    if (d.kind === "stage" && (!validStage(d.stage) || d.stage.referenceIds?.some(id => assets.get(id)?.kind !== "image") ||
        d.stage.objects.some(o => o.referenceAssetId && assets.get(o.referenceAssetId)?.kind !== "image") ||
        (d.stage.backgroundId && assets.get(d.stage.backgroundId)?.kind !== "image")))
      throw fail("导演台的场景、机位或背景图无效");
    for (const kind of ["image", "video", "audio"]) {
      const optimization = d[kind + "PromptOptimization"];
      if (optimization == null) continue;
      if (
        d.kind !== kind ||
        typeof optimization.text !== "string" || optimization.text.length > 8000 ||
        typeof optimization.basis !== "string" || optimization.basis.length > 150000 ||
        typeof optimization.modelName !== "string" || optimization.modelName.length > 100 ||
        typeof optimization.profileId !== "string" || optimization.profileId.length > 100
      ) throw fail("节点提示词优化稿无效");
    }
    if (
      d.pendingCanvasJob !== undefined &&
      (typeof d.pendingCanvasJob !== "string" ||
        d.pendingCanvasJob.length > 100)
    )
      throw fail("画布任务引用无效");
    if (
      d.workflowValues !== undefined &&
      (!d.workflowValues ||
        typeof d.workflowValues !== "object" ||
        Array.isArray(d.workflowValues) ||
        Object.keys(d.workflowValues).length > 3000 ||
        Object.values(d.workflowValues).some(
          (v) => !["string", "number", "boolean"].includes(typeof v),
        ))
    )
      throw fail("工作流字段格式无效");
    if (
      d.poseSwapRefs !== undefined &&
      (!d.poseSwapRefs || typeof d.poseSwapRefs !== "object" || Array.isArray(d.poseSwapRefs) ||
        Object.entries(d.poseSwapRefs).some(([role, id]) =>
          !Object.hasOwn(poseSwapRoles, role) || typeof id !== "string" || id.length > 100))
    ) throw fail("PoseSwap 参考图格式无效");
    if (d.poseSwapOwnerId !== undefined &&
        (d.kind !== "image" || typeof d.poseSwapOwnerId !== "string" ||
          !d.poseSwapOwnerId || d.poseSwapOwnerId.length > 100))
      throw fail("PoseSwap 参考节点来源无效");
    if (
      d.canvasGroup !== undefined &&
      (typeof d.canvasGroup !== "string" || d.canvasGroup.length > 100)
    )
      throw fail("画布编组无效");
    if (
      d.canvasGroupName !== undefined &&
      (typeof d.canvasGroupName !== "string" ||
        !d.canvasGroupName.trim() ||
        d.canvasGroupName.length > 100)
    )
      throw fail("资产组名称无效");
    for (const groups of [d.mediaRefOrder, d.selectedMediaRefs]) {
      if (groups !== undefined &&
        (!groups || typeof groups !== "object" || Array.isArray(groups) ||
        Object.entries(groups).some(
          ([kind, ids]) =>
            !["audio", "video"].includes(kind) ||
            !Array.isArray(ids) ||
            ids.length > 2000 ||
            ids.some((id) => typeof id !== "string" || id.length > 160) ||
            new Set(ids).size !== ids.length,
        ))
      ) throw fail("音视频引用列表无效");
    }
    if (d.imageTask !== undefined && (d.kind !== "image" || !["turnaround","panorama"].includes(d.imageTask))) throw fail("图片创作类型无效");
    for (const ids of [d.imageRefOrder, d.canvasRefIds]) {
      if (ids !== undefined && (!Array.isArray(ids) || ids.length > 2000 ||
          ids.some((id) => typeof id !== "string" || !id || id.length > 160) ||
          new Set(ids).size !== ids.length))
        throw fail("图片引用列表无效");
    }
    if (
      d.imageLoras !== undefined &&
      (!Array.isArray(d.imageLoras) ||
        d.imageLoras.length > 8 ||
        d.imageLoras.some(
          (l) =>
            !l ||
            typeof l.name !== "string" ||
            l.name.length > 1500 ||
            !Number.isFinite(l.strength) ||
            l.strength < 0 ||
            l.strength > 2,
        ) ||
        new Set(d.imageLoras.map((l) => l.name)).size !== d.imageLoras.length)
    )
      throw fail("LoRA 配置无效，最多可叠加 8 个风格");
    if (d.imageMark != null) {
      const mark = d.imageMark;
      if (
        assets.get(mark.assetId)?.kind !== "image" ||
        [mark.x, mark.y].some(
          (v) => !Number.isInteger(v) || v < 0 || v > 100,
        ) ||
        typeof mark.note !== "string" ||
        mark.note.length > 500
      )
        throw fail("参考图标记无效");
    }
    if (
      (d.canvasRatio !== undefined && !Object.hasOwn(ratios, d.canvasRatio)) ||
      (d.guideAssetId && assets.get(d.guideAssetId)?.kind !== "image") ||
      (d.videoRestoreSource != null && (d.kind !== "video" ||
        typeof d.videoRestoreSource.nodeId !== "string" ||
        assets.get(d.videoRestoreSource.assetId)?.kind !== "video")) ||
      (d.customSize != null &&
        ![d.customSize.width, d.customSize.height].every(
          (v) => Number.isSafeInteger(v) && v > 0 && v <= 131072,
        )) ||
      [
        d.canvasRef,
        d.styleHint,
        d.imageModel,
        d.videoModel,
        d.audioModel,
        d.imageVae,
      ].some(
        (value) =>
          value !== undefined &&
          (typeof value !== "string" || value.length > 1500),
      )
    )
      throw fail("节点生成参数无效");
    if (d.kind === "shot") {
      const refs = d.referenceIds === undefined ? [] : d.referenceIds;
      if (
        !Array.isArray(refs) ||
        refs.some((id) => !cardTypes.has(id)) ||
        new Set(refs).size !== refs.length
      )
        throw fail("分镜引用了缺失或重复的设定卡");
      if (
        (d.emptyCast !== undefined && typeof d.emptyCast !== "boolean") ||
        (d.emptyCast && refs.some((id) => cardTypes.get(id) === "character"))
      )
        throw fail("空镜不能同时指定角色");
      if (
        Object.keys(shotFields).some(
          (key) =>
            d[key] !== undefined &&
            (typeof d[key] !== "string" || d[key].length > 1500),
        )
      )
        throw fail("单个分镜字段最多 1500 字");
    }
    if (d.assetId) {
      const a = assets.get(d.assetId);
      if (
        !a ||
        !(d.kind === "shot"
          ? ["image", "video"].includes(a.kind)
          : a.kind === (d.kind === "stage" ? "image" : d.kind))
      )
        throw fail("节点素材类型不匹配");
    }
    ids.add(n.id);
    if (d.kind === "shot") shotIds.add(n.id);
  }
  if (
    new Set(order).size !== order.length ||
    order.length !== shotIds.size ||
    order.some((id) => !shotIds.has(id))
  )
    throw fail("分镜顺序无效");
  const groups = canvasGroups(nodes);
  if ([...groups.keys()].some((id) => ids.has(id)))
    throw fail("资产组与节点标识冲突");
  const edgeIds = new Set();
  for (const e of edges) {
    if (
      !validCanvasEndpoints(ids, groups, e?.source, e?.target) ||
      typeof e.id !== "string" ||
      edgeIds.has(e.id)
    )
      throw fail("连线无效");
    edgeIds.add(e.id);
  }
  return {
    name: name.trim(),
    referenceCards: referenceCards.map(
      ({ id, type, name, description, imageId }) => ({
        id,
        type,
        name: name.trim(),
        description,
        imageId: imageId || "",
      }),
    ),
    series: {
      style: series.style,
      cast: series.cast,
      world: series.world,
      ratio: series.ratio,
      refAssetId: series.refAssetId || "",
    },
    nodes: nodes.map(({ id, position, data }) => ({
      id,
      type: "studio",
      position,
      data,
    })),
    edges: edges.map(({ id, source, target }) => ({ id, source, target })),
    order,
  };
}
