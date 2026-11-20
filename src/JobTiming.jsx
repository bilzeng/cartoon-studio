import React, { useEffect, useState } from "react";
import { durationText, jobTimes } from "../shared/job-timing.js";

function stepProgress(job) {
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
  const count = uploading
    ? `第 ${upload.current} / ${upload.total} 个`
    : sampling ? `第 ${step.value} / ${step.max} 步` : "";
  const freshness = executing || uploading ? [
    progressStream === "offline" ? "步骤连接中断，正在重连"
      : executing && age >= 30000 ? "正在等待下一步回报" : "",
    Number.isFinite(age) ? "上次更新 " + durationText(age) + "前" : "等待服务器回传步骤",
  ].filter(Boolean).join(" · ") : "";
  return { stage, value, max, count, freshness };
}

export function JobTiming({ job, showSteps = false, statusLabel, syncFailed = false }) {
  const running = job?.status === "running";
  const [, tick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [running]);

  if (!job) return null;
  const progress = showSteps && running && job.phase !== "waiting" ? stepProgress(job) : null;
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
  if (!parts.length && !statusLabel) return null;
  const explanation =
    running && job.estimateSamples
      ? "按同一环境、同配置最近 " +
        job.estimateSamples +
        " 次成功任务估算执行时间，排队和文件传输另计。"
      : "总耗时从工作台提交任务起算。执行时间取自 ComfyUI 的执行记录。";
  const timing = parts.join(" · ");
  const compactTiming = [timing, progress?.freshness].filter(Boolean).join(" · ");
  return (
    <>
      {statusLabel && (
        <div className="generation-status-line">
          <span className="generation-status" aria-live="polite" data-status={job.status}
            title={[progress?.stage, job.detail || statusLabel].filter(Boolean).join("\n")}>
            {progress?.stage || statusLabel}
          </span>
          {progress?.count && <b className="generation-step-count">{progress.count}</b>}
          {progress && (
            <div className="video-step-track" role="progressbar" aria-label={progress.stage}
              aria-valuemin={progress.max ? 0 : undefined}
              aria-valuemax={progress.max}
              aria-valuenow={progress.value}>
              {progress.max !== undefined && <i style={{ width: (100 * progress.value) / progress.max + "%" }} />}
            </div>
          )}
        </div>
      )}
      <small className="job-timing" role={syncFailed ? "status" : undefined}
        aria-live={syncFailed ? "polite" : "off"}
        title={statusLabel && compactTiming ? compactTiming + "\n" + explanation : explanation}>
        {syncFailed ? "暂时无法读取生成状态，正在重试…" : compactTiming}
      </small>
    </>
  );
}
