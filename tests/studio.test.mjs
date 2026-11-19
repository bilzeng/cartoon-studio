import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { makeNode, splitScript } from "../shared/studio.js";
import { canvasInputs, resolveImages, resolveWorkflowInputs } from "../shared/canvas.js";
import { optimizationContext } from "../shared/prompt-optimizer.js";

let dir,
  app,
  comfy,
  base,
  imageBytes,
  movieBytes,
  graph,
  receivedImage,
  uploadedImage;
const request = async (route, method = "GET", data) => {
  const bin = Buffer.isBuffer(data);
  const r = await fetch(base + "/api" + route, {
    method,
    headers: data
      ? {
          "Content-Type": bin ? "application/octet-stream" : "application/json",
        }
      : {},
    body: data ? (bin ? data : JSON.stringify(data)) : undefined,
  });
  return { status: r.status, body: await r.json() };
};
const listen = (server) =>
  new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "cartoon-test-"));
  process.env.STUDIO_DATA_DIR = dir;
  const { studioApi } = await import("../server/api.mjs");
  delete process.env.COMFYUI_IMAGE_WORKFLOW;
  delete process.env.COMFYUI_VIDEO_WORKFLOW;
  delete process.env.COMFYUI_TOKEN;
  app = createServer(studioApi());
  await listen(app);
  base = "http://127.0.0.1:" + app.address().port;
  imageBytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+p9ioAAAAASUVORK5CYII=",
    "base64",
  );
  const movie = path.join(dir, "provider-fixture.mp4");
  execFileSync("ffmpeg", [
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=s=32x32:d=0.1",
    "-c:v",
    "libx264",
    movie,
  ]);
  movieBytes = await readFile(movie);
  comfy = createServer(async (req, res) => {
    if (req.url === "/models/checkpoints")
      return res.end(JSON.stringify(["fixture.safetensors"]));
    const inventory = {
      "/models/diffusion_models": [
        "z/z_image_turbo_fp32.safetensors",
        "wan/wan2.1_t2v_1.3b_fp32.safetensors",
        "extra/other.safetensors",
      ],
      "/models/text_encoders": [
        "z/qwen3_4b_bf16.safetensors",
        "umt5_xxl_bf16.safetensors",
      ],
      "/models/vae": ["z/ae.safetensors", "wan/wan2.1_vae.pth"],
      "/object_info/SparkTTSRun": { SparkTTSRun: { input: { required: {
        text: ["STRING"], gender: [["female"]], age: [["Youth-Adult"]], pitch: [["moderate"]], speed: [["moderate"]],
      } } } },
      "/object_info/SaveAudioMP3": { SaveAudioMP3: { output_node: true } },
      "/object_info/VHS_VideoCombine": {
        VHS_VideoCombine: {
          input: { required: { format: [["video/h264-mp4"]] } },
        },
      },
    };
    if (Object.hasOwn(inventory, req.url))
      return res.end(JSON.stringify(inventory[req.url]));
    if (req.url === "/prompt") {
      const parts = [];
      for await (const chunk of req) parts.push(chunk);
      graph = JSON.parse(Buffer.concat(parts)).prompt;
      return res.end(JSON.stringify({ prompt_id: "ticket" }));
    }
    if (req.url === "/upload/image") {
      const form = await new Response(req, {
        headers: { "Content-Type": req.headers["content-type"] },
      }).formData();
      uploadedImage = Buffer.from(await form.get("image").arrayBuffer());
      receivedImage = true;
      return res.end('{"name":"radio.jpg","subfolder":"test"}');
    }
    if (req.url === "/history/ticket")
      return res.end(
        JSON.stringify({
          ticket: {
            status: { completed: true, messages: [
              ["execution_start", { timestamp: 10000 }],
              ["execution_success", { timestamp: 10500 }],
            ] },
            outputs: graph.out?.class_type === "SaveAudioMP3" ? {
              out: { audio: [{ filename: "voice.wav" }] },
            } : {
              7: Object.values(graph).some((n) => n.class_type === "SaveImage")
                ? { images: [{ filename: "image.png" }] }
                : { videos: [{ filename: "video.mp4" }] },
            },
          },
        }),
      );
    if (req.url.startsWith("/view?") && req.url.includes("voice.wav"))
      return res.end(Buffer.from("UklGRiYAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQIAAAAAAA==", "base64"));
    if (req.url.startsWith("/view?"))
      return res.end(req.url.includes("video.mp4") ? movieBytes : imageBytes);
    res.writeHead(404);
    res.end();
  });
  await listen(comfy);
  process.env.COMFYUI_URL = "http://127.0.0.1:" + comfy.address().port;
});
after(async () => {
  for (const server of [app, comfy]) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  await rm(dir, { recursive: true, force: true });
});
async function finished(project, job) {
  for (let i = 0; i < 180; i++) {
    const rows = (await request("/jobs?project=" + project)).body;
    const row = rows.find((r) => r.id === job);
    if (row && row.status !== "running") {
      assert.equal(row.status, "done", row.detail);
      return row;
    }
    await sleep(100);
  }
  assert.fail("任务未在测试时限内完成");
}
test("剧本分段、镜头引用、画布持久化、版本冲突和草稿恢复", async () => {
  assert.deepEqual(splitScript("灯亮了。她拿起耳机！"), [
    "灯亮了。",
    "她拿起耳机！",
  ]);
  const { body: p } = await request("/projects", "POST", {
    template: "signal",
  });
  const { id, revision } = p;
  const q = { ...p, name: "修改版", order: [...p.order].reverse() };
  assert.equal(
    (await request("/projects/" + id, "PUT", q)).body.revision,
    revision + 1,
  );
  assert.equal((await request("/projects/" + id, "PUT", p)).status, 409);
  assert.deepEqual((await request("/projects/" + id)).body.order, q.order);
  const restored = await request("/projects", "POST", { board: q });
  assert.equal(restored.status, 201);
  assert.notEqual(restored.body.id, id);
  assert.equal(
    (await request("/projects", "POST", { board: { ...q, order: [] } })).status,
    400,
  );
});
test("大文件上传后原样保存为普通媒体文件并可播放", async () => {
  const bytes = Buffer.alloc(5 * 1024 * 1024 + 19, 0x7a);
  imageBytes.copy(bytes);
  const upload = await request("/assets?name=large.png", "POST", bytes);
  assert.equal(upload.status, 201);
  const { url } = upload.body;
  assert.deepEqual(
    await readFile(path.join(dir, "media", "图片", "large.png")),
    bytes,
  );
  const response = await fetch(base + url);
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
});
test("上传素材、绑定分镜、配乐导出并用 ffprobe 检查音视频轨道", async () => {
  const { body: p } = await request("/projects", "POST", {});
  const jpeg = await readFile(
    new URL("../public/stills/coast.jpg", import.meta.url),
  );
  assert.equal(
    (await request("/assets?name=bad", "POST", Buffer.from("<html>"))).status,
    400,
  );
  const builtinUpload = await request("/assets?name=coast.jpg", "POST", jpeg);
  assert.equal(builtinUpload.status, 200);
  const photo = builtinUpload.body;
  assert.ok(photo.builtin && photo.duplicate);
  const shot = makeNode("shot", { x: 100, y: 100 }, { duration: 1 });
  const pic = makeNode("image", { x: 0, y: 100 }, { assetId: photo.id });
  p.nodes.push(shot, pic);
  p.order = [shot.id];
  p.edges = [{ id: "photo-ref", source: pic.id, target: shot.id }];
  const saved = (await request("/projects/" + p.id, "PUT", p)).body;
  execFileSync("ffmpeg", [
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=1",
    path.join(dir, "tone.wav"),
  ]);
  const audio = (
    await request(
      "/assets?name=tone.wav",
      "POST",
      await readFile(path.join(dir, "tone.wav")),
    )
  ).body;
  const job = await request("/projects/" + p.id + "/export", "POST", {
    revision: saved.revision,
    audioId: audio.id,
  });
  assert.equal(job.status, 202);
  const done = await finished(p.id, job.body.id);
  const asset = (await request("/assets")).body.find(
    (a) => a.id === done.assetId,
  );
  const media = await fetch(base + asset.url);
  assert.equal(media.status, 200);
  const bytes = Buffer.from(await media.arrayBuffer());
  const file = path.join(dir, "media", asset.diskFile);
  assert.deepEqual(await readFile(file), bytes);
  const partial = await fetch(base + asset.url, {
    headers: { range: "bytes=0-15" },
  });
  assert.equal(partial.status, 206);
  assert.deepEqual(
    Buffer.from(await partial.arrayBuffer()),
    bytes.subarray(0, 16),
  );

  const probe = JSON.parse(
    execFileSync("ffprobe", [
      "-v",
      "error",
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      file,
    ]),
  );
  assert.deepEqual(
    probe.streams.map((s) => s.codec_name),
    ["h264", "aac"],
  );
  assert.equal(probe.streams[0].width, 1280);
  assert.equal(probe.streams[0].height, 720);
  assert.ok(Math.abs(Number(probe.format.duration) - 1) < 0.08);

  const clip = makeNode(
    "shot",
    { x: 300, y: 0 },
    { assetId: asset.id, duration: 1 },
  );
  saved.nodes.push(clip);
  saved.order.push(clip.id);
  const mix = (await request("/projects/" + p.id, "PUT", saved)).body;
  const second = await request("/projects/" + p.id + "/export", "POST", {
    revision: mix.revision,
  });
  assert.equal(second.status, 202);
  const mixed = await finished(p.id, second.body.id);
  const movie = (await request("/assets")).body.find(
    (a) => a.id === mixed.assetId,
  );
  const samples = execFileSync("ffmpeg", [
    "-loglevel",
    "error",
    "-i",
    path.join(dir, "media", movie.diskFile),
    "-map",
    "0:a:0",
    "-ar",
    "8000",
    "-ac",
    "1",
    "-f",
    "s16le",
    "-",
  ]);
  const audible = (time) => {
    const start = Math.floor(time * 8000) * 2;
    for (let i = start; i < start + 3200; i += 2)
      if (Math.abs(samples.readInt16LE(i)) > 400) return true;
    return false;
  };
  assert.equal(audible(0.3), false);
  assert.equal(audible(1.3), true);
});
test("ComfyUI 合同测试涵盖种子、文生图、参考图上传、视频工作流和产物入库", async () => {
  const project = (await request("/projects", "POST", { name: "生成联调" }))
    .body;
  const url = "/projects/" + project.id + "/generate";
  assert.equal(
    (await request(url, "POST", { checkpoint: "none", prompt: "test" })).status,
    400,
  );
  const image = await request(url, "POST", {
    checkpoint: "fixture.safetensors",
    prompt: "blue coast",
  });
  assert.equal(image.status, 202);
  const first = await finished(project.id, image.body.id);
  assert.equal(graph["2"].inputs.text, "blue coast");
  assert.equal(typeof graph["5"].inputs.seed, "number");
  assert.equal(
    (await request("/assets")).body.find((a) => a.id === first.assetId).kind,
    "image",
  );
  process.env.COMFYUI_VIDEO_WORKFLOW = path.join(dir, "workflow.json");
  await writeFile(
    process.env.COMFYUI_VIDEO_WORKFLOW,
    JSON.stringify({
      7: {
        class_type: "ContractFixture",
        inputs: { prompt: "{{prompt}}", seed: "{{seed}}", image: "{{image}}" },
      },
    }),
  );
  assert.equal((await request("/engine")).body.video.needsImage, true);
  assert.equal(
    (await request(url, "POST", { kind: "video", prompt: "slow pan" })).status,
    400,
  );
  const video = await request(url, "POST", {
    kind: "video",
    assetId: "coast",
    prompt: "slow pan",
  });
  assert.equal(video.status, 202);
  const second = await finished(project.id, video.body.id);
  assert.equal(graph["7"].inputs.image, "test/radio.jpg");
  assert.equal(graph["7"].inputs.prompt, "slow pan");
  assert.ok(receivedImage);
  assert.equal(
    (await request("/assets")).body.find((a) => a.id === second.assetId).kind,
    "video",
  );
});

test("剧集设定可跨集复用，分镜保持独立，旧项目补全默认设定", async () => {
  const series = {
    style: "水墨",
    cast: "阿梨，白斗篷",
    world: "雨夜山城",
    ratio: "9:16",
    refAssetId: "coast",
  };
  const first = (
    await request("/projects", "POST", {
      name: "第一集",
      script: "旅人下山。\n关门声响起。",
      series,
    })
  ).body;
  const next = (
    await request("/projects", "POST", {
      name: "第二集",
      script: "清晨，新船靠岸。",
      series: first.series,
    })
  ).body;
  assert.equal(first.order.length, 2);
  assert.equal(next.order.length, 1);
  assert.notEqual(next.order[0], first.order[0]);
  assert.deepEqual(next.series, series);
  assert.equal(next.nodes[1].data.assetId, "");
  assert.equal(
    (await request("/projects/" + first.id)).body.nodes[1].data.text,
    "旅人下山。",
  );
  assert.equal(
    (await request("/projects", "POST", { series: { ratio: "2:3" } })).status,
    400,
  );
  assert.equal(
    (await request("/projects", "POST", { series: { refAssetId: "missing" } }))
      .status,
    400,
  );
  const legacy = { ...first };
  delete legacy.series;
  await writeFile(
    path.join(dir, "projects", first.name, "画布.json"),
    JSON.stringify(legacy),
  );
  assert.equal(
    (await request("/projects/" + first.id)).body.series.ratio,
    "16:9",
  );
});

test("分体模型、镜头角色、参考图和自定义图片工作流", async () => {
  delete process.env.COMFYUI_VIDEO_WORKFLOW;
  const s = (await request("/engine")).body;
  assert.ok(s.inventory.diffusion_models.includes("extra/other.safetensors"));
  assert.equal(s.video.native, true);
  assert.ok(
    s.imageModels.find((x) => x.id === "studio:z-image-turbo").reference,
  );
  const p = (
    await request("/projects", "POST", {
      series: { ratio: "9:16", style: "动画", cast: "常驻角色" },
    })
  ).body;
  const url = "/projects/" + p.id + "/generate";
  const args = {
    kind: "image",
    checkpoint: "studio:z-image-turbo",
    prompt: "草地",
    shotCast: "空镜，无人出场",
    assetId: "coast",
  };
  const image = await request(url, "POST", args);
  assert.equal(image.status, 202);
  await finished(p.id, image.body.id);
  assert.equal(graph["1"].inputs.unet_name, "z/z_image_turbo_fp32.safetensors");
  assert.equal(graph["11"].inputs.image, "test/radio.jpg");
  assert.deepEqual(
    [graph["12"].inputs.width, graph["12"].inputs.height],
    [432, 768],
  );
  assert.match(graph["4"].inputs.text, /空镜，无人出场/);
  assert.doesNotMatch(graph["4"].inputs.text, /常驻角色/);
  const motion = await request(url, "POST", {
    kind: "video",
    prompt: "晨雾散去",
    duration: 2,
  });
  assert.equal(motion.status, 202);
  await finished(p.id, motion.body.id);
  assert.deepEqual(
    [
      graph["7"].inputs.width,
      graph["7"].inputs.height,
      graph["7"].inputs.length,
    ],
    [288, 512, 33],
  );
  process.env.COMFYUI_IMAGE_WORKFLOW = path.join(dir, "image.json");
  try {
    await writeFile(
      process.env.COMFYUI_IMAGE_WORKFLOW,
      JSON.stringify({
        1: {
          class_type: "SaveImage",
          inputs: {
            prompt: "{{prompt}}",
            width: "{{width}}",
            height: "{{height}}",
            seed: "{{seed}}",
            image: "{{image}}",
          },
        },
      }),
    );
    assert.equal(
      (await request("/engine")).body.imageModels[0].needsImage,
      true,
    );
    assert.equal(
      (
        await request(url, "POST", {
          ...args,
          checkpoint: "studio:custom-image",
          assetId: "",
        })
      ).status,
      400,
    );
    const custom = await request(url, "POST", {
      ...args,
      checkpoint: "studio:custom-image",
    });
    await finished(p.id, custom.body.id);
    assert.equal(graph["1"].inputs.image, "test/radio.jpg");
    assert.equal(graph["1"].inputs.height, 768);
  } finally {
    delete process.env.COMFYUI_IMAGE_WORKFLOW;
  }
});

test("设定卡可跨集复制，阻止悬空、重复引用及空镜角色冲突", async () => {
  const cards = [
    {
      id: "mei",
      type: "character",
      name: "小梅",
      description: "青衣",
      imageId: "operator",
    },
    {
      id: "room",
      type: "scene",
      name: "山屋",
      description: "木屋",
      imageId: "coast",
    },
    { id: "key", type: "prop", name: "钥匙", description: "黄铜", imageId: "" },
  ];
  const { body: p } = await request("/projects", "POST", {
    script: "她开门。",
    referenceCards: cards,
  });
  const shot = p.nodes[1];
  shot.data.referenceIds = cards.map((c) => c.id);
  const saved = (await request("/projects/" + p.id, "PUT", p)).body;
  assert.deepEqual(saved.nodes[1].data.referenceIds, shot.data.referenceIds);
  const { body: next } = await request("/projects", "POST", {
    script: "晨光照进来。",
    referenceCards: saved.referenceCards,
  });
  next.referenceCards[0].description = "红衣";
  await request("/projects/" + next.id, "PUT", next);
  assert.equal(
    (await request("/projects/" + p.id)).body.referenceCards[0].description,
    "青衣",
  );
  const { shotPrompt } = await import("../shared/storyboard.js");
  assert.doesNotMatch(
    shotPrompt(
      { ...p, series: { cast: "小梅" } },
      { text: "空房间", emptyCast: true, referenceIds: ["room"] },
    ),
    /小梅/,
  );
  for (const invalid of [
    { referenceIds: ["missing"] },
    { referenceIds: ["room", "room"] },
    { emptyCast: true, referenceIds: ["mei"] },
  ]) {
    const b = structuredClone(saved);
    Object.assign(b.nodes[1].data, invalid);
    assert.equal((await request("/projects/" + p.id, "PUT", b)).status, 400);
  }
  assert.equal(
    (
      await request("/projects/" + p.id, "PUT", {
        ...saved,
        referenceCards: [],
      })
    ).status,
    400,
  );
});

test("单镜生成按提交快照和镜头 ID 归档，改顺序或改设定不会改动旧候选", async () => {
  const { adoptTake } = await import("../shared/storyboard.js");
  const ref = {
    id: "lamp",
    type: "prop",
    name: "提灯",
    description: "黄铜灯",
    imageId: "coast",
  };
  let p = (
    await request("/projects", "POST", {
      template: "signal",
      referenceCards: [ref],
    })
  ).body;
  const url = "/projects/" + p.id,
    target = p.order[1],
    initialIds = [...p.order];
  let n = p.nodes.find((n) => n.id === target);
  Object.assign(n.data, {
    text: "点灯",
    referenceIds: ["lamp"],
    framing: "中景",
    dialogue: "回家",
    lighting: "月光",
  });
  p = (await request(url, "PUT", p)).body;
  const args = {
    kind: "image",
    checkpoint: "studio:z-image-turbo",
    revision: p.revision,
    shotId: target,
    assetId: "coast",
  };
  assert.equal(
    (await request(url + "/generate", "POST", { ...args, revision: 0 })).status,
    409,
  );
  assert.equal(
    (await request(url + "/generate", "POST", { ...args, shotId: "missing" }))
      .status,
    404,
  );
  const ticket = (
    await request(url + "/generate", "POST", {
      ...args,
      prompt: "陈旧的浏览器提示词",
    })
  ).body;
  assert.ok(ticket.id, JSON.stringify(ticket));
  const before = structuredClone(p);
  p.order.reverse();
  p.referenceCards[0].description = "银质灯";
  p.nodes.find((n) => n.id === target).data.framing = "手部特写";
  p = (await request(url, "PUT", p)).body;
  await finished(p.id, ticket.id);
  assert.match(graph["4"].inputs.text, /中景/);
  assert.doesNotMatch(graph["4"].inputs.text, /回家|陈旧|银质灯/);
  const list = url + "/shots/" + target + "/takes";
  const [v1] = (await request(list)).body;
  assert.equal(v1.snapshot.references[0].description, "黄铜灯");
  assert.equal(v1.snapshot.fields.dialogue, "回家");
  assert.equal(v1.snapshot.imageId, "coast");
  assert.equal(v1.snapshot.seed, graph["8"].inputs.seed);
  const again = (
    await request(url + "/generate", "POST", { ...args, revision: p.revision })
  ).body;
  await finished(p.id, again.id);
  const [v2, old] = (await request(list)).body;
  assert.equal(v2.id, again.id);
  assert.equal(old.id, v1.id);
  assert.match(v2.snapshot.prompt, /手部特写/);
  assert.equal(v2.snapshot.references[0].description, "银质灯");
  assert.equal(
    (await request(url)).body.nodes.find((n) => n.id === target).data.assetId,
    before.nodes.find((n) => n.id === target).data.assetId,
  );
  const adopted = (await request(url, "PUT", adoptTake(p, v2))).body;
  assert.equal(
    adopted.nodes.find((n) => n.id === target).data.assetId,
    v2.assetId,
  );
  for (const id of [initialIds[0], initialIds[2]]) {
    assert.deepEqual(
      adopted.nodes.find((n) => n.id === id),
      before.nodes.find((n) => n.id === id),
    );
    assert.deepEqual((await request(url + "/shots/" + id + "/takes")).body, []);
  }
  assert.throws(() => adoptTake({ ...p, id: "another-project" }, v2));
  assert.throws(() => adoptTake({ ...p, nodes: [] }, v2));
  assert.equal(
    adoptTake(adopted, v1).nodes.find((n) => n.id === target).data.assetId,
    v1.assetId,
  );
});

test("画布双向建连、采用的上游图片和文本进入 ComfyUI，请求绑定到原节点", async () => {
  const { addCanvasNode, canvasInputs, settleCanvasJobs } =
    await import("../shared/canvas.js");
  let p = (
    await request("/projects", "POST", {
      board: {
        name: "自由画布",
        series: { ratio: "9:16" },
        nodes: [],
        edges: [],
        order: [],
      },
    })
  ).body;
  const pic = makeNode(
    "image",
    { x: 0, y: 0 },
    { assetId: "coast", title: "起始画面" },
  );
  const out = makeNode(
    "image",
    { x: 510, y: 100 },
    {
      title: "下游",
      text: "暖光",
      canvasRatio: "16:9",
      imageMark: { assetId: "coast", x: 25, y: 75, note: "保留灯塔" },
    },
  );
  const words = makeNode(
    "text",
    { x: 45, y: 42 },
    { title: "美术设定", text: "雨夜水彩" },
  );
  p = addCanvasNode(p, pic);
  p = addCanvasNode(p, out, pic.id, "source");
  p = addCanvasNode(p, words, out.id, "target");
  assert.deepEqual(
    p.edges.map((e) => [e.source, e.target]),
    [
      [pic.id, out.id],
      [words.id, out.id],
    ],
  );
  assert.throws(() => addCanvasNode(p, words, "已删除", "source"));
  const url = "/projects/" + p.id;
  p = (await request(url, "PUT", p)).body;
  const input = canvasInputs(p, out, [{ id: "coast", kind: "image" }]);
  assert.equal(input.reference, "coast");
  assert.match(input.prompt, /雨夜水彩/);
  assert.match(input.prompt, /25%.*75%.*保留灯塔/);
  const args = {
    kind: "image",
    checkpoint: "studio:z-image-turbo",
    nodeId: out.id,
    revision: p.revision,
    prompt: "不应使用",
    assetId: "missing",
  };
  assert.equal(
    (await request(url + "/generate", "POST", { ...args, revision: 0 })).status,
    409,
  );
  assert.equal(
    (await request(url + "/generate", "POST", { ...args, nodeId: words.id }))
      .status,
    400,
  );
  receivedImage = false;
  const submitted = await request(url + "/generate", "POST", args);
  assert.equal(submitted.status, 202);
  await finished(p.id, submitted.body.id);
  assert.equal(graph["4"].inputs.text, input.prompt);
  assert.equal(graph["11"].inputs.image, "test/radio.jpg");
  assert.equal(graph["12"].inputs.width, 768);
  assert.ok(receivedImage);
  const result = (await request(url + "/nodes/" + out.id + "/jobs")).body;
  assert.equal(result[0].id, submitted.body.id);
  assert.equal(result[0].executionMs, 500);
  assert.ok(result[0].elapsedMs >= 0);
  assert.equal(result[0].elapsedMs, Date.parse(result[0].finishedAt) - Date.parse(result[0].created));
  const job = { ...result[0], nodeId: out.id };
  assert.deepEqual(
    (await request(url + "/nodes/" + out.id + "/jobs?job=other")).body,
    [],
  );
  assert.equal(
    (await request(url + "/nodes/" + out.id + "/jobs?job=" + job.id)).body[0]
      .id,
    job.id,
  );
  const queued = structuredClone(p);
  queued.nodes.find((n) => n.id === out.id).data.pendingCanvasJob = job.id;
  const completed = new Map([[job.id, job]]);
  const settled = settleCanvasJobs(queued, completed);
  assert.equal(
    settled.nodes.find((n) => n.id === out.id).data.assetId,
    job.assetId,
  );
  assert.equal(
    settled.nodes.find((n) => n.id === out.id).data.pendingCanvasJob,
    undefined,
  );
  const generating = queued.nodes.find((n) => n.id === out.id);
  generating.data.assetId = generating.data.pendingImageSource = "operator";
  assert.equal(
    settleCanvasJobs(queued, completed).nodes.find((n) => n.id === out.id).data
      .assetId,
    job.assetId,
  );
  const failed = new Map([
    [job.id, { ...job, status: "failed", assetId: null }],
  ]);
  assert.equal(
    settleCanvasJobs(queued, failed).nodes.find((n) => n.id === out.id).data
      .assetId,
    "operator",
  );
  generating.data.assetId = "coast";
  assert.equal(
    settleCanvasJobs(queued, completed).nodes.find((n) => n.id === out.id).data
      .assetId,
    "coast",
  );
  assert.deepEqual(
    settleCanvasJobs(queued, new Map([[job.id, { ...job, nodeId: pic.id }]])),
    queued,
  );
  const waiting = structuredClone(p);
  waiting.nodes.find((n) => n.id === pic.id).data.assetId = "";
  assert.ok(canvasInputs(waiting, out, []).awaitingImage);
  assert.equal(
    canvasInputs(
      waiting,
      { ...out, data: { ...out.data, canvasRef: "none" } },
      [],
    ).awaitingImage,
    false,
  );
  assert.deepEqual(
    (await request(url + "/nodes/" + pic.id + "/jobs")).body,
    [],
  );
  assert.equal(
    (await request(url)).body.nodes.find((n) => n.id === out.id).data.assetId,
    "",
  );
  const cleared = canvasInputs({ ...p, edges: [] }, out, [
    { id: "coast", kind: "image" },
  ]);
  assert.equal(cleared.reference, "");
  assert.doesNotMatch(cleared.prompt, /雨夜水彩|保留灯塔/);
});

test("生图和旁白工作流接收已采用的稿件，改写原文后提交新的原文", async () => {
  const engine = (await request("/engine")).body;
  for (const [kind, modelId, original, draft] of [
    ["image", "studio:z-image-turbo", "山中小屋", "松林深处，一间木屋透出微弱的暖光。"],
    ["audio", "studio:preset:spark-narration", "灯亮了你看", "灯亮了，你看。"],
  ]) {
    const node = makeNode(kind, { x: 0, y: 0 }, { text: original, [kind + "Model"]: modelId });
    let project = (await request("/projects", "POST", {
      board: { name: "优化稿联调", nodes: [node], edges: [], order: [] },
    })).body;
    const url = "/projects/" + project.id;
    const model = engine[kind + "Models"].find(m => m.id === modelId);
    const resolve = model.workflow ? resolveWorkflowInputs : resolveImages;
    const resolvePrompt = (n) => resolve(canvasInputs(project, n, []), n, [], model);
    const context = optimizationContext(node.data, model, resolvePrompt(node), project.series.ratio);
    project.nodes[0].data[kind + "PromptOptimization"] = {
      basis: JSON.stringify(context), text: draft, modelName: "测试", profileId: "test",
    };
    for (const adopted of [true, false]) {
      if (!adopted) project.nodes[0].data.text = "起雾了";
      const saved = await request(url, "PUT", project);
      assert.equal(saved.status, 200);
      project = saved.body;
      const submitted = await request(url + "/generate", "POST", { nodeId: node.id, kind, revision: project.revision });
      assert.equal(submitted.status, 202, JSON.stringify(submitted.body));
      await finished(project.id, submitted.body.id);
      const expected = adopted ? draft : resolvePrompt(project.nodes[0]).prompt;
      assert.equal((kind === "audio" ? graph.speech : graph["4"]).inputs.text, expected);
    }
  }
});

test("旧资产组改名后，以一条组连线为生图和图生视频提交 @ 选中的素材", async (t) => {
  const { groupPortId, regroupNodes, removeCanvasNodes } =
    await import("../shared/canvasGroups.js");
  const key = "编组 1",
    source = groupPortId(key),
    pos = { x: 0, y: 0 };
  const a = makeNode("image", pos, { canvasGroup: key, assetId: "coast" });
  const b = makeNode("shot", pos, {
    canvasGroup: key,
    assetId: "operator",
    text: "组内另存的镜头描述",
  });
  const image = makeNode("image", pos, {
    text: "@图2 望向窗外",
    imageRefOrder: [a.id, b.id],
  });
  const video = makeNode("video", pos, {
    text: "@图2 缓慢转身",
    imageRefOrder: [a.id, b.id],
  });
  const created = await request("/projects", "POST", {
    board: {
      name: "资产组联调",
      nodes: [a, b, image, video],
      order: [b.id],
      edges: [
        { id: "g-image", source, target: image.id },
        { id: "g-video", source, target: video.id },
      ],
    },
  });
  assert.equal(created.status, 201);
  const url = "/projects/" + created.body.id;
  const board = created.body;
  for (const n of board.nodes.filter((n) => n.data.canvasGroup))
    n.data.canvasGroupName = "海岸素材";
  const saved = await request(url, "PUT", board);
  assert.equal(saved.status, 200);
  const invalid = await request(url, "PUT", {
    ...saved.body,
    edges: [{ id: "loop", source, target: a.id }],
  });
  assert.equal(invalid.status, 400);
  const previous = process.env.COMFYUI_VIDEO_WORKFLOW;
  t.after(() => {
    if (previous) process.env.COMFYUI_VIDEO_WORKFLOW = previous;
    else delete process.env.COMFYUI_VIDEO_WORKFLOW;
  });
  process.env.COMFYUI_VIDEO_WORKFLOW = path.join(dir, "group-video.json");
  await writeFile(
    process.env.COMFYUI_VIDEO_WORKFLOW,
    JSON.stringify({
      7: {
        class_type: "ContractFixture",
        inputs: { prompt: "{{prompt}}", image: "{{image}}" },
      },
    }),
  );
  const expected = await readFile(
    new URL("../public/stills/operator.jpg", import.meta.url),
  );
  for (const n of [image, video]) {
    uploadedImage = null;
    const submitted = await request(url + "/generate", "POST", {
      nodeId: n.id,
      kind: n.data.kind,
      checkpoint: "studio:z-image-turbo",
      revision: saved.body.revision,
    });
    assert.equal(submitted.status, 202, JSON.stringify(submitted.body));
    await finished(board.id, submitted.body.id);
    assert.deepEqual(uploadedImage, expected);
    assert.doesNotMatch(JSON.stringify(graph), /组内另存的镜头描述|@图2/);
  }
  const extended = regroupNodes(board, [a.id, b.id, image.id], key, "海岸素材");
  assert.ok(
    extended.edges.some((e) => e.source === source && e.target === video.id),
  );
  assert.ok(
    !extended.edges.some((e) => e.source === source && e.target === image.id),
  );
  const dissolved = regroupNodes(board, [a.id, b.id], "", "");
  assert.deepEqual(
    dissolved.edges.map((e) => e.source),
    [a.id, b.id, a.id, b.id],
  );
  assert.deepEqual(removeCanvasNodes(board, [a.id, b.id]).edges, []);
});
