import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { hostname } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { enqueue, cancelJob, scheduleJobs } from "../server/generation-queue.mjs";
import { jobs, changeJobs } from "../server/storage.mjs";
import { withEnvironment } from "../server/environments.mjs";

test("工作台队列从磁盘恢复，按顺序自动补位，跳过取消项并锁定素材参数", async t => {
  const started = [];
  const engine = createServer(async (req, res) => {
    if (req.url === "/prompt") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const prompt = JSON.parse(Buffer.concat(chunks)).prompt;
      started.push(prompt[2].inputs.text);
      return res.end(JSON.stringify({ prompt_id: String(started.length) }));
    }
    if (req.url.startsWith("/history/")) {
      const id = req.url.split("/").pop();
      return res.end(JSON.stringify({ [id]: { status: { completed: true }, outputs: { 7: { images: [{ filename: "ok.png" }] } } } }));
    }
    if (req.url.startsWith("/view?")) return res.end(Buffer.from("89504e470d0a1a0a", "hex"));
    res.writeHead(404); res.end();
  });
  engine.listen(0, "127.0.0.1");
  await once(engine, "listening");
  t.after(() => engine.close());
  const environment = "http://127.0.0.1:" + engine.address().port;
  const payload = { checkpoint: "model", prompt: "恢复的镜头", seed: 42, assetTitle: "镜头" };
  const active = id => ({ id, status: "running", owner: { host: hostname(), pid: process.pid } });
  await changeJobs(items => items.push(
    { id: "restored", project: "demo", type: "image", phase: "waiting", status: "running", environment, payload },
    active("A"), active("B"),
  ));
  scheduleJobs();
  const add = (nodeId, prompt) => withEnvironment(environment, () =>
    enqueue("demo", "image", prompt, { ...payload, prompt }, { nodeId }));
  const skip = await add("skip", "点错的镜头");
  const next = await add("next", "提交时的镜头");
  const duplicate = await add("next", "编辑后的镜头");
  assert.equal(duplicate.id, next.id);
  assert.equal((await jobs()).find(j => j.id === next.id).queuePosition, 3);
  assert.equal((await cancelJob(skip.id)).status, "cancelled");
  assert.equal((await jobs()).find(j => j.id === next.id).queuePosition, 2);
  assert.deepEqual(started, []);
  await changeJobs(items => { items.find(j => j.id === "A").status = "done"; });
  scheduleJobs();
  async function until(check) {
    for (let i = 0; i < 160; i++) {
      if (await check()) return;
      await sleep(50);
    }
    assert.fail("队列没有自动推进");
  }
  await until(() => started.length === 1);
  assert.deepEqual(started, ["恢复的镜头"]);
  assert.equal((await jobs()).find(j => j.id === next.id).queuePosition, 1);
  await until(async () => (await jobs()).find(j => j.id === next.id).status === "done");
  assert.deepEqual(started, ["恢复的镜头", "提交时的镜头"]);
  assert.ok((await jobs()).filter(j => ["restored", next.id].includes(j.id)).every(j => j.assetId && !j.payload));
});
