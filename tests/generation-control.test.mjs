import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { generationControl } from "../server/generation-control.mjs";
import { cancelComfyPrompt } from "../server/comfy.mjs";
import { withEnvironment } from "../server/environments.mjs";

test("上传时取消禁止随后提交，提交回执在路上时等待并仅取消该编号", async () => {
  const stopped = [];
  const stop = async id => stopped.push(id);
  const early = generationControl(stop);
  await early.cancel();
  assert.throws(() => early.submit(() => assert.fail("不应提交")), { name: "AbortError" });
  assert.deepEqual(stopped, []);

  const sent = generationControl(stop);
  const ticket = Promise.withResolvers();
  sent.submit(() => ticket.promise);
  const pending = [sent.cancel(), sent.cancel()];
  assert.deepEqual(stopped, []);
  ticket.resolve({ prompt_id: "selected" });
  await Promise.all(pending);
  await sent.cancel();
  assert.deepEqual(stopped, ["selected"]);
  assert.ok(sent.signal.aborted);
});

test("远程取消未确认时允许重试", async () => {
  let attempts = 0;
  const control = generationControl(async () => { if (!attempts++) throw Error("连接中断"); });
  await control.submit(async () => ({ prompt_id: "test" }));
  await assert.rejects(control.cancel(), /连接中断/);
  assert.equal(control.signal.aborted, false);
  await control.cancel();
  assert.ok(control.signal.aborted);
});

test("旧环境只删除指定排队项，刚转为执行的任务按编号中断", async t => {
  const calls = [];
  let queued = true, promote = false, version = "0.3.57";
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    res.setHeader("Content-Type", "application/json");
    if (req.url.endsWith("/cancel")) { res.writeHead(404); return res.end(); }
    if (req.url === "/system_stats") return res.end(JSON.stringify({ system: { comfyui_version: version }, devices: [] }));
    if (req.url === "/queue" && req.method === "GET") return res.end(JSON.stringify({
      queue_pending: queued ? [[9, "wrong"], [10, "keep"]] : [[10, "keep"]],
      queue_running: [[8, promote && !queued ? "wrong" : "other"]],
    }));
    if (req.url.startsWith("/history/")) return res.end("{}");
    calls.push([req.url, body]);
    queued = false;
    res.end("{}");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const cancel = () => withEnvironment("http://127.0.0.1:" + server.address().port, () => cancelComfyPrompt("wrong"), "");
  await cancel();
  assert.deepEqual(calls, [["/queue", { delete: ["wrong"] }]]);
  queued = true;
  promote = true;
  await cancel();
  assert.deepEqual(calls.slice(1), [["/queue", { delete: ["wrong"] }], ["/interrupt", { prompt_id: "wrong" }]]);
  version = "0.3.56";
  await assert.rejects(cancel(), /仅支持取消排队任务/);
  assert.equal(calls.length, 3);
});
