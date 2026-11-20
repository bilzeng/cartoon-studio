import { hostname } from "node:os";
import { makeId } from "../shared/studio.js";
import { currentUrl, withEnvironment } from "./environments.mjs";
import { generationControl } from "./generation-control.mjs";
import { cancelComfyPrompt, generateAudio, generateImage, generateVideo } from "./comfy.mjs";
import { renderFilm } from "./render.mjs";
import { executionEstimate } from "./generation-timing.mjs";
import { jobs, changeJobs, fail, now } from "./storage.mjs";

const capacity = 2;
const active = new Map();
const waiting = j => j.status === "running" && j.phase === "waiting";
const occupied = j => j.status === "running" && j.phase !== "waiting";
let timer;

export async function enqueue(project, type, detail, payload, { take, nodeId, modelId, panorama, inputAssets = [] } = {}) {
  let id = makeId();
  await changeJobs(items => {
    // A double click or retry on the same canvas node returns its existing ticket.
    const prior = nodeId && items.find(j => j.status === "running" && j.project === project && j.nodeId === nodeId);
    if (prior) { id = prior.id; return; }
    items.unshift({
      id, project, type, detail, status: "running", phase: "waiting", created: now(),
      nodeId, modelId, title: payload.assetTitle, shotId: take?.shotId, snapshot: take, assetId: null,
      ...(panorama && {panorama:true}),
      inputAssetIds: [...new Set(inputAssets.map(a => a.id))],
      environment: currentUrl(), payload,
    });
  });
  scheduleJobs();
  return { id };
}

export function scheduleJobs(delay = 0) {
  if (timer && delay) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    timer = undefined;
    dispatch().catch(err => {
      console.error("读取生成队列失败", err.message);
      scheduleJobs(2000);
    });
  }, delay);
  timer.unref();
}

async function dispatch() {
  const rows = await jobs();
  if (!rows.some(waiting)) return;
  if (rows.filter(occupied).length >= capacity) { scheduleJobs(2000); return; }
  const claimed = [];
  const updated = await changeJobs(items => {
    const slots = capacity - items.filter(occupied).length;
    for (let i = items.length - 1; i >= 0 && claimed.length < slots; i--) {
      const job = items[i];
      if (!waiting(job)) continue;
      claimed.push({ ...job });
      delete job.payload;
      Object.assign(job, { phase: "preparing", owner: { pid: process.pid, host: hostname() } });
    }
  });
  for (const job of claimed) {
    const control = job.type === "export" ? null : generationControl(
      id => withEnvironment(job.environment, () => cancelComfyPrompt(id)),
    );
    if (control) active.set(job.id, control);
    run(job, control).catch(err => console.error("生成记录写入失败", err.message)).finally(() => {
      active.delete(job.id);
      scheduleJobs();
    });
  }
  if (updated.some(waiting)) scheduleJobs(2000);
}

function update(id, status, detail, assetId, timing) {
  return changeJobs(items => {
    const job = items.find(j => j.id === id);
    if (!job || job.status !== "running") return;
    if (timing?.workloadKey) Object.assign(job, executionEstimate(items, timing.workloadKey));
    Object.assign(job, timing, { status, detail, assetId });
    if (status !== "running") job.finishedAt = now();
  });
}

async function run(job, control) {
  const progress = (detail, timing) => update(job.id, "running", detail, null, timing);
  if (control) Object.assign(progress, { signal: control.signal, submit: control.submit });
  try {
    const generate = { image: generateImage, audio: generateAudio, video: generateVideo, export: renderFilm }[job.type];
    const asset = await withEnvironment(job.environment, () => generate(job.payload, progress, job.project));
    await update(job.id, "done", job.detail, asset.id);
  } catch (err) {
    await control?.cancelling?.catch(() => {});
    if (control?.signal.aborted || err.code === "GENERATION_CANCELLED")
      return update(job.id, "cancelled", "已取消生成", null);
    const detail = err.code === "ENOENT" ? "找不到 FFmpeg，请安装并加入 PATH"
      : err.status ? err.message : "处理失败，请检查素材是否可播放以及 FFmpeg 编码器是否可用";
    await update(job.id, "failed", detail, null);
  }
}

export async function cancelJob(id) {
  const rows = await changeJobs(items => {
    const job = items.find(j => j.id === id);
    if (!job) throw fail("任务不存在", 404);
    if (waiting(job)) {
      delete job.payload;
      Object.assign(job, { status: "cancelled", detail: "已取消生成", finishedAt: now() });
    }
  });
  const job = rows.find(j => j.id === id);
  if (job.status === "cancelled") return job;
  if (job.status !== "running") throw fail("任务已结束，请查看生成记录", 409);
  const control = active.get(id);
  if (!control) throw fail("当前服务无法取消这条任务", 409);
  await control.cancel();
  const updated = await update(id, "cancelled", "已取消生成", null);
  const current = updated.find(j => j.id === id);
  if (current.status !== "cancelled") throw fail("任务已结束，请查看生成记录", 409);
  return current;
}
