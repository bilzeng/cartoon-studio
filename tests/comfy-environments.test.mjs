import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { makeNode } from "../shared/studio.js";
import { canvasInputs, resolveImages } from "../shared/canvas.js";
import { h3ContinuationModelId } from "../shared/h3-video.js";

test("按实际节点定义导入工作流，切换机器后原任务和凭据仍绑定提交环境", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "studio-environments-"));
  process.env.STUDIO_DATA_DIR = dir;
  const bytes = Buffer.from("89504e470d0a1a0a", "hex");
  const schema = {
    InkSource: {
      input: {
        required: {
          weights: [["local/edition.weights", "local/other.weights"]],
        },
      },
      output: ["MODEL"],
    },
    Pinhole: {
      input: {
        required: {
          photo: ["COMBO", { options: ["example.png"], image_upload: true }],
        },
      },
      output: ["IMAGE"],
    },
    CustomRender: {
      input: {
        required: {
          words: ["STRING", {}],
          model: ["MODEL"],
          subject: ["IMAGE"],
          strength: ["FLOAT", { min: 0, max: 1 }],
        },
      },
      output: ["IMAGE"],
    },
    Printer: { output_node: true, input: { required: { frame: ["IMAGE"] } } },
    LoraLoaderModelOnly: {
      input: { required: { lora_name: [["ink/etch.pt"]] } },
    },
  };
  async function listen(server) {
    await new Promise((done) => server.listen(0, "127.0.0.1", done));
    t.after(
      () =>
        new Promise((done) => {
          server.close(done);
          server.closeAllConnections();
        }),
    );
    return "http://127.0.0.1:" + server.address().port;
  }
  async function provider(prefix) {
    const calls = [],
      graphs = [];
    let release;
    const gate = new Promise((r) => (release = r));
    const url = await listen(
      createServer(async (req, res) => {
        calls.push([req.url, req.headers.authorization]);
        res.setHeader("content-type", "application/json");
        const send = (x) => res.end(JSON.stringify(x));
        if (req.url === "/system_stats")
          return send({ system: { comfyui_version: "fixture" }, devices: [] });
        if (req.url.startsWith("/object_info/")) {
          const type = decodeURIComponent(req.url.split("/").pop());
          if (prefix === "first" && type === "AICG3D_H3Loader") {
            res.statusCode = 500;
            return send({ error: "optional plugin could not load" });
          }
          return send(schema[type] ? { [type]: schema[type] } : {});
        }
        if (req.url.startsWith("/models/")) return send([]);
        if (req.url === "/upload/image") {
          for await (const _ of req) {
          }
          return send({ name: prefix + ".png" });
        }
        if (req.url === "/prompt") {
          let body = "";
          for await (const chunk of req) body += chunk;
          graphs.push(JSON.parse(body).prompt);
          return send({ prompt_id: prefix });
        }
        if (req.url === "/history/" + prefix) {
          await gate;
          return send({
            [prefix]: {
              status: { completed: true },
              outputs: { print: { images: [{ filename: "result.png" }] } },
            },
          });
        }
        if (req.url.startsWith("/view?")) return res.end(bytes);
        res.writeHead(404);
        res.end();
      }),
    );
    return { url, calls, graphs, release };
  }
  const first = await provider("first"),
    second = await provider("second");
  process.env.COMFYUI_URL = first.url;
  delete process.env.COMFYUI_TOKEN;
  const { studioApi } = await import("../server/api.mjs");
  const local = await listen(createServer(studioApi()));
  async function api(route, method = "GET", data) {
    const r = await fetch(local + "/api" + route, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    return { status: r.status, body: await r.json() };
  }
  const switchTo = (machine, name, token) =>
    api("/environments", "PUT", { url: machine.url, name, token });
  assert.equal((await switchTo(first, "A", "private-token-A")).status, 200);
  assert.ok(
    !JSON.stringify((await api("/environments")).body).includes(
      "private-token",
    ),
  );
  const pref = (params) =>
    api("/lora-preferences", "PUT", { environment: first.url, ...params });
  await pref({ action: "import", favorites: ["old"], recent: ["ink"] });
  await Promise.all([
    pref({ action: "star", name: "ink" }),
    pref({ action: "use", name: "new" }),
  ]);
  const prefs = (
    await api("/lora-preferences?environment=" + encodeURIComponent(first.url))
  ).body;
  assert.deepEqual(prefs.favorites, ["old", "ink"]);
  assert.deepEqual(prefs.recent, ["new", "ink"]);
  const editor = {
    nodes: [
      { id: 1, type: "Pinhole", widgets_values: ["example.png"] },
      { id: 2, type: "Printer", inputs: [{ name: "frame", link: 1 }] },
    ],
    links: [[1, 1, 0, 2, 0, "IMAGE"]],
  };
  const inspectedEditor = await api("/workflows/inspect", "POST", {
    graph: editor,
  });
  assert.equal(inspectedEditor.status, 200);
  assert.equal(inspectedEditor.body.images[0].id, "1");
  assert.equal(inspectedEditor.body.outputs[0].id, "2");
  const graph = {
    base: {
      class_type: "InkSource",
      inputs: { weights: "local/edition.weights" },
    },
    photo: { class_type: "Pinhole", inputs: { photo: "example.png" } },
    render: {
      class_type: "CustomRender",
      inputs: {
        model: ["base", 0],
        subject: ["photo", 0],
        words: "placeholder",
        strength: 0.8,
      },
    },
    print: { class_type: "Printer", inputs: { frame: ["render", 0] } },
  };
  const inspect = (await api("/workflows/inspect", "POST", { graph })).body;
  assert.equal(inspect.images.length, 1);
  const key = (...v) => JSON.stringify(v);
  const bindings = {
    prompt: key("render", "words"),
    output: "print",
    images: [key("photo", "photo")],
    styleSource: key("base", 0),
    styleFiles: ["ink/etch.pt"],
  };
  const preset = (
    await api("/workflows", "POST", {
      name: "铜版",
      graph,
      bindings,
      environment: first.url,
    })
  ).body;
  const source = makeNode("image", { x: 0, y: 0 }, { assetId: "coast" });
  const target = makeNode(
    "image",
    { x: 500, y: 0 },
    {
      text: "雨夜的@图1",
      imageRefOrder: [source.id],
      imageModel: preset.id,
      imageLoras: [{ name: "ink/etch.pt", strength: 0.65 }],
      workflowValues: { [key("render", "strength")]: 0.25 },
    },
  );
  const board = (
    await api("/projects", "POST", {
      board: {
        name: "验证",
        nodes: [source, target],
        edges: [{ id: "wire", source: source.id, target: target.id }],
        order: [],
      },
    })
  ).body;
  const params = {
    kind: "image",
    nodeId: target.id,
    revision: board.revision,
    environment: first.url,
  };
  const url = "/projects/" + board.id;
  assert.equal((await api(url + "/generate", "POST", params)).status, 202);
  await switchTo(second, "B");
  assert.equal((await api(url + "/generate", "POST", params)).status, 409);
  assert.equal(
    (
      await api(url + "/generate", "POST", {
        ...params,
        environment: second.url,
      })
    ).status,
    400,
  );
  assert.ok(
    !(await api("/engine")).body.imageModels.some((m) => m.id === preset.id),
  );
  first.release();
  second.release();
  let rows;
  for (let i = 0; i < 100; i++) {
    rows = (await api(url + "/nodes/" + target.id + "/jobs")).body;
    if (rows[0].status !== "running") break;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(rows[0].status, "done", rows[0].detail);
  assert.equal(first.graphs[0].render.inputs.words, "雨夜的图1");
  assert.equal(first.graphs[0].photo.inputs.photo, "first.png");
  assert.equal(first.graphs[0].render.inputs.strength, 0.25);
  assert.equal(
    first.graphs[0][first.graphs[0].render.inputs.model[0]].inputs
      .strength_model,
    0.65,
  );
  assert.ok(second.calls.every(([, token]) => token === undefined));
  assert.ok(
    first.calls.every(([, token]) => token === "Bearer private-token-A"),
  );
  assert.ok(
    !second.calls.some(([u]) => u.startsWith("/history/") || u === "/prompt"),
  );
  await switchTo(first, "A");
  const { body: engine } = await api("/engine");
  assert.equal(engine.online, true);
  assert.ok(engine.unavailable.some((m) => m.id === h3ContinuationModelId));
  assert.ok(
    engine.imageModels
      .find((m) => m.id === preset.id)
      ?.fields.some((f) => f.input === "weights"),
  );
  await rm(dir, { recursive: true, force: true });
});

test("提示词编号绑定上游身份，断开后不能将原引用指向另一张图", () => {
  const a = makeNode("image", { x: 0, y: 0 }, { assetId: "a" }),
    b = makeNode("image", { x: 0, y: 220 }, { assetId: "b" }),
    target = makeNode(
      "image",
      { x: 450, y: 0 },
      { text: "@图2 的人物", imageRefOrder: [a.id, b.id] },
    );
  const assets = [
      { id: "a", kind: "image" },
      { id: "b", kind: "image" },
    ],
    board = {
      series: {},
      nodes: [target, a, b],
      edges: [{ target: target.id, source: b.id }],
    };
  const resolve = () =>
    resolveImages(canvasInputs(board, target, assets), target, assets, {
      family: "qwen21",
      maxRefs: 2,
    });
  assert.equal(resolve().selected[0].id, b.id);
  assert.equal(resolve().prompt, "<image1> 的人物");
  target.data.text = "@图1 的灯塔";
  assert.match(resolve().error, /已断开/);
});
