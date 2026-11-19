import { createHash } from "node:crypto";

// Generated adapters get fresh node IDs on each submission. Match their types,
// connections and settings while ignoring prompts, seeds and media filenames.
export function workloadKey(environment, graph) {
  const nodes = Object.values(graph).map(({ class_type, inputs }) => {
    const settings = Object.entries(inputs || {})
      .sort(([a], [b]) => a.localeCompare(b))
      .flatMap(([name, value]) => {
        if (Array.isArray(value) && value.length === 2 && graph[value[0]])
          return [[name, [graph[value[0]].class_type, value[1]]]];
        if (["seed", "noise_seed", "filename_prefix"].includes(name)) return [];
        if (
          typeof value === "string" &&
          (/^(text|prompt|positive|negative|image|video|audio)$/.test(name) ||
            (/^PrimitiveString/.test(class_type) && name === "value"))
        )
          return [];
        return [[name, value]];
      });
    return JSON.stringify([class_type, settings]);
  });
  return createHash("sha256")
    .update(JSON.stringify([environment, nodes.sort()]))
    .digest("hex");
}

export function executionDuration(messages) {
  if (!Array.isArray(messages)) return null;
  const start = messages.find(([type]) => type === "execution_start")?.[1]
    ?.timestamp;
  const end = messages.find(([type]) =>
    ["execution_success", "execution_error", "execution_interrupted"].includes(
      type,
    ),
  )?.[1]?.timestamp;
  return Number.isFinite(start) && Number.isFinite(end) && end >= start
    ? end - start
    : null;
}

export function executionEstimate(rows, key) {
  const samples = rows
    .filter(
      (j) =>
        j.status === "done" &&
        j.workloadKey === key &&
        Number.isFinite(j.executionMs) &&
        j.executionMs > 0,
    )
    .slice(0, 5)
    .map((j) => j.executionMs)
    .sort((a, b) => a - b);
  if (!samples.length) return {};
  const middle = Math.floor(samples.length / 2);
  const median =
    samples.length % 2
      ? samples[middle]
      : (samples[middle - 1] + samples[middle]) / 2;
  return {
    estimatedExecutionMs: Math.round(median),
    estimateSamples: samples.length,
  };
}
