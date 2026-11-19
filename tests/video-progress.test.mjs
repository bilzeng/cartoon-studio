import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { WebSocketServer } from "ws";
import { setTimeout as sleep } from "node:timers/promises";
import { watchExecution } from "../server/comfy-progress.mjs";
import { bundledPresets } from "../server/presets/catalog.mjs";
import { videoUpscale2kId } from "../shared/generation-size.js";
import { bindPreset } from "../server/workflow-presets.mjs";

test("progress events can precede the ticket, stay scoped, and reset for a new node", async (t) => {
  const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await once(server, "listening");
  t.after(() => server.close());
  const connected = once(server, "connection");
  const watch = watchExecution(
    "http://127.0.0.1:" + server.address().port + "/comfy",
    "test-token",
    "client",
    {
      a: { class_type: "Sampler", _meta: { title: "视频采样" } },
      b: { class_type: "VAEDecode" },
    },
  );
  t.after(() => watch.close());
  const [peer, request] = await connected;
  assert.equal(request.url, "/comfy/ws?clientId=client");
  assert.equal(request.headers.authorization, "Bearer test-token");
  await watch.ready;
  const send = (type, data) => peer.send(JSON.stringify({ type, data }));
  const waitFor = async (fn) => {
    for (let i = 0; i < 100; i++) {
      if (fn()) return;
      await sleep(5);
    }
    assert.fail("no update");
  };
  send("progress", { prompt_id: "job", node: "a", value: 2, max: 8 });
  await sleep(20);
  watch.bind("job");
  await waitFor(() => watch.read().step?.value === 2);
  const prev = watch.read().step;
  send("progress", { prompt_id: "other", node: "a", value: 8, max: 8 });
  send("status", { exec_info: { queue_remaining: 0 } });
  peer.send(Buffer.from([2, 3, 4]));
  await sleep(20);
  assert.equal(watch.read().step, prev);
  assert.equal(prev.stage, "视频采样");
  send("executing", { prompt_id: "job", node: "b" });
  await waitFor(() => watch.read().step?.stage === "VAEDecode");
  assert.equal(watch.read().step.max, undefined);
  assert.equal(watch.read().step.startedAt, prev.startedAt);
  peer.close();
  await waitFor(() => watch.read().stream === "offline");
});

test("2K enhancement binds the original video, uses its fps and soundtrack, and fits its orientation", () => {
  const preset = bundledPresets.find((p) => p.id === videoUpscale2kId);
  const { graph, prepareVideoRefs } = bindPreset(
    preset,
    { fields: [], needsImage: false },
    {},
    [],
    3072,
    0,
    { video: [{}] },
  );
  assert.equal(graph.source.inputs.file, "{{video1}}");
  assert.ok(!prepareVideoRefs);
  assert.deepEqual(graph[205].inputs.images, ["components", 0]);
  assert.deepEqual(graph[213].inputs.fps, ["components", 2]);
  assert.deepEqual(graph[213].inputs.audio, ["components", 1]);
  assert.equal(graph[212].class_type, "ResizeAndPadImage");
  assert.deepEqual(preset.bindings.outputSize, [2560, 1440]);
  assert.equal(preset.bindings.prompt, "");
  for (const n of Object.values(graph))
    for (const v of Object.values(n.inputs))
      if (Array.isArray(v)) assert.ok(graph[v[0]]);
});
