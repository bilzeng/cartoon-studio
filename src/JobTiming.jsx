import React, { useEffect, useState } from "react";
import { durationText, jobTimes } from "../shared/job-timing.js";

function StepProgress({ job }) {
  const { phase, step, progressStream, upload } = job;
  const uploading = phase === "uploading" && upload?.total > 0;
  const executing = phase === "executing";
  const sampling = executing && Number.isFinite(step?.value) && step.max > 0;
  const value = uploading
    ? upload.current - 1
    : sampling
      ? step.value
      : undefined;
  const max = uploading ? upload.total : sampling ? step.max : undefined;
  const stage = uploading
    ? job.detail?.startsWith("正在重试")
      ? "重新上传素材"
      : "上传素材"
    : phase === "downloading"
      ? "下载成片"
      : phase === "queued"
        ? "等待 ComfyUI 执行"
        : executing
          ? step?.stage || "等待步骤回报"
          : /^正在(重试)?(准备|上传)/.exec(job.detail || "")?.[0] ||
            "准备工作流";
  const updatedAt = uploading ? upload.updatedAt : step?.updatedAt;
  const age = Math.max(0, Date.now() - Date.parse(updatedAt));
  return (
    <div className="video-step">
      <div className="video-step-title">
        <strong>{stage}</strong>
        {uploading && (
          <b>
            第 {upload.current} / {upload.total} 个
          </b>
        )}
        {sampling && (
          <b>
            第 {step.value} / {step.max} 步
          </b>
        )}
      </div>
      <div
        className="video-step-track"
        role="progressbar"
        aria-label={stage}
        aria-valuemin={max ? 0 : undefined}
        aria-valuemax={max}
        aria-valuenow={value}
      >
        {max !== undefined && <i style={{ width: (100 * value) / max + "%" }} />}
      </div>
      {(executing || uploading) && (
        <small>
          {progressStream === "offline" ? "步骤连接中断，正在重连 · " : ""}
          {Number.isFinite(age)
            ? "上次更新 " + durationText(age) + "前"
            : "等待服务器回传步骤"}
        </small>
      )}
    </div>
  );
}

export function JobTiming({ job, showSteps = false }) {
  const running = job?.status === "running";
  const [, tick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [running]);

  if (!job) return null;
  const { elapsedMs, estimatedRemainingMs } = jobTimes(job);
  const parts = [];
  if (elapsedMs !== null)
    parts.push((running ? "已用 " : "总耗时 ") + durationText(elapsedMs));
  if (Number.isFinite(job.executionMs))
    parts.push("执行 " + durationText(job.executionMs));
  if (running && ["queued", "executing"].includes(job.phase)) {
    if (!job.estimateSamples) parts.push("暂无同配置估时样本");
    else if (job.phase === "queued")
      parts.push("预计执行约 " + durationText(job.estimatedExecutionMs));
    else if (estimatedRemainingMs > 0)
      parts.push(
        "执行预计还需约 " + durationText(Math.max(1000, estimatedRemainingMs)),
      );
    else if (estimatedRemainingMs === 0) parts.push("执行已达到预估时长");
  }
  if (!parts.length && !(showSteps && running)) return null;
  const explanation =
    running && job.estimateSamples
      ? "按同一环境、同配置最近 " +
        job.estimateSamples +
        " 次成功任务估算执行时间，排队和文件传输另计。"
      : "总耗时从工作台提交任务起算。执行时间取自 ComfyUI 的执行记录。";
  return (
    <>
      {showSteps && running && <StepProgress job={job} />}
      <small className="job-timing" aria-live="off" title={explanation}>
        {parts.join(" · ")}
      </small>
    </>
  );
}
