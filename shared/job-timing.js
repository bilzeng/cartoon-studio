// Local elapsed time includes preparation, queue time and result transfer.
export function jobTimes(job, now = Date.now()) {
  const end = job.status === "running" ? now : Date.parse(job.finishedAt);
  const elapsed = end - Date.parse(job.created);
  const result = {
    elapsedMs: Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null,
  };
  if (
    job.status === "running" &&
    job.phase === "executing" &&
    Number.isFinite(job.estimatedExecutionMs)
  ) {
    const since = now - Date.parse(job.executionObservedAt);
    if (Number.isFinite(since))
      result.estimatedRemainingMs = Math.max(
        0,
        job.estimatedExecutionMs - Math.max(0, since),
      );
  }
  return result;
}

export function durationText(milliseconds) {
  const seconds = Math.round(milliseconds / 1000);
  if (seconds < 60) return seconds + " 秒";
  return Math.floor(seconds / 60) + " 分 " + (seconds % 60) + " 秒";
}
