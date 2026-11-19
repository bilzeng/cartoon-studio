import test from "node:test";
import assert from "node:assert/strict";
import {
  executionDuration,
  executionEstimate,
  workloadKey,
} from "../server/generation-timing.mjs";
import { jobTimes, durationText } from "../shared/job-timing.js";

test("estimates match environment and generation settings across fresh submission IDs", () => {
  function graph(id, seed, duration, model) {
    return {
      [id]: {
        class_type: "PrimitiveStringMultiline",
        inputs: { value: "scene " + seed },
      },
      video: {
        class_type: "VideoSampler",
        inputs: { model, seconds: duration, seed, prompt: [id, 0] },
      },
      image: { class_type: "LoadImage", inputs: { image: seed + ".png" } },
    };
  }
  const key = workloadKey("a", graph("promptA", 2, 8, "h3"));
  assert.equal(workloadKey("a", graph("promptB", 3, 8, "h3")), key);
  assert.notEqual(workloadKey("b", graph("promptA", 2, 8, "h3")), key);
  assert.notEqual(workloadKey("a", graph("promptA", 2, 5, "h3")), key);
  assert.notEqual(workloadKey("a", graph("promptA", 2, 8, "other")), key);
});

test("only recent successful matching execution durations count", () => {
  const rows = [900, 5, 30, 20, 50, 2].map((executionMs) => ({
    status: "done",
    workloadKey: "a",
    executionMs,
  }));
  rows.unshift(
    { ...rows[0], status: "failed" },
    { ...rows[0], workloadKey: "b" },
    { ...rows[0], executionMs: null },
  );
  assert.deepEqual(executionEstimate(rows, "a"), {
    estimatedExecutionMs: 30,
    estimateSamples: 5,
  });
  assert.deepEqual(executionEstimate(rows, "c"), {});
  assert.deepEqual(executionEstimate(rows.slice(-2), "a"), {
    estimatedExecutionMs: 26,
    estimateSamples: 2,
  });
});

test("elapsed and estimated remaining reflect independent local and execution clocks", () => {
  const job = {
    status: "running",
    created: new Date(10000).toISOString(),
    phase: "queued",
    estimatedExecutionMs: 30000,
  };
  assert.deepEqual(jobTimes(job, 15000), { elapsedMs: 5000 });
  Object.assign(job, {
    phase: "executing",
    executionObservedAt: new Date(20000).toISOString(),
  });
  assert.deepEqual(jobTimes(job, 30000), {
    elapsedMs: 20000,
    estimatedRemainingMs: 20000,
  });
  assert.deepEqual(jobTimes(job, 60000), {
    elapsedMs: 50000,
    estimatedRemainingMs: 0,
  });
  assert.deepEqual(jobTimes({ ...job, phase: "downloading" }, 65000), {
    elapsedMs: 55000,
  });
  assert.deepEqual(jobTimes({ ...job, status: "failed" }), { elapsedMs: null });
  assert.deepEqual(
    jobTimes({
      ...job,
      status: "done",
      finishedAt: new Date(82000).toISOString(),
    }),
    { elapsedMs: 72000 },
  );
  assert.equal(durationText(255842), "4 分 16 秒");
});

test("ComfyUI execution times require both timestamped events", () => {
  const start = ["execution_start", { timestamp: 500 }];
  assert.equal(executionDuration(), null);
  assert.equal(executionDuration([start]), null);
  assert.equal(
    executionDuration([start, ["execution_success", { timestamp: 480 }]]),
    null,
  );
  for (const type of [
    "execution_success",
    "execution_error",
    "execution_interrupted",
  ])
    assert.equal(
      executionDuration([start, [type, { timestamp: 14500 }]]),
      14000,
    );
});
