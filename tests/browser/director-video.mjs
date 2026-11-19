import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { createServer, preview } from "vite";
import { PerspectiveCamera, Vector3 } from "three";
import { makeNode } from "../../shared/studio.js";
import { stageObject } from "../../shared/director-stage.js";
import { propCatalog } from "../../shared/stage-props.js";
import { canvasInputs, resolveWorkflowInputs } from "../../shared/canvas.js";

test("点击地面安排走位，添加曲线运镜，导出的视频在画布播放并接入下游", async t => {
  const dir = await mkdtemp(path.join(tmpdir(),"studio-walk-video-"));
  process.env.STUDIO_DATA_DIR = dir;
  t.after(() => rm(dir,{recursive:true,force:true}));
  const server = process.env.DIRECTOR_BUILD_QA
    ? await preview({preview:{port:0,strictPort:false},logLevel:"error"})
    : await createServer({server:{port:0,strictPort:false,hmr:false},logLevel:"error"});
  if (!process.env.DIRECTOR_BUILD_QA) await server.listen();
  t.after(() => server.close());
  const base = server.resolvedUrls.local[0];
  const browser = await chromium.launch({args:["--use-angle=swiftshader","--enable-unsafe-swiftshader"]});
  t.after(() => browser.close());
  const page = await browser.newPage({viewport:{width:1460,height:950}});
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on("pageerror",e => errors.push(e.message));
  const node = makeNode("stage",{x:0,y:0},{title:"公园走位"});
  const stage = node.data.stage;
  stage.objects[0].position = [-1.35,0,0];
  stage.objects[1].position = [0,1.55,5.55];
  for (const [shape,position] of [["bench",[.55,0,-1.6]],["lamp",[1.95,0,-2]],["tree",[-2,0,-2.6]]]) {
    const {size,name,color} = propCatalog[shape];
    stage.objects.push({...stageObject("prop"),name,shape,position,size,color});
  }
  stage.animation = {endFrame:60,cuts:[]};
  const created = await page.request.post(base+"api/projects",{data:{board:{name:"预演视频测试",nodes:[node],edges:[],order:[]}}});
  assert.equal(created.status(),201);
  const board = await created.json(), endpoint = base+"api/projects/"+board.id;
  const button = name => page.getByRole("button",{name,exact:true});
  await page.goto(base+"#project/"+board.id);
  await button("打开导演台").click();
  await button("走位").click();
  await button("结束布点").waitFor();
  const surface = page.getByLabel("三维场景视窗");
  const head = page.getByLabel("时间轴播放头");
  async function place(x,z) {
    const rect = await surface.boundingBox();
    const camera = new PerspectiveCamera(36,rect.width/rect.height,.04,300);
    camera.position.set(3.25,2.4,5.6); camera.lookAt(0,.85,0); camera.updateMatrixWorld();
    const p = new Vector3(x,0,z).project(camera);
    await page.mouse.click(rect.x+(p.x+1)*rect.width/2,rect.y+(1-p.y)*rect.height/2);
  }
  await place(.22,.3);
  await page.waitForFunction(() => Number(document.querySelector('[aria-label="时间轴播放头"]').value)>10);
  const first = Number(await head.inputValue());
  await place(1.35,.1);
  await page.waitForFunction(f => Number(document.querySelector('[aria-label="时间轴播放头"]').value)>f,first);
  await button("预览走位").click();
  await button("暂停").click();
  await head.press("Home");
  await button("运镜").click();
  await page.getByRole("combobox",{name:"运镜方式"}).click();
  await page.getByRole("option",{name:"弧线推近",exact:true}).click();
  await page.getByRole("combobox",{name:"运镜速度曲线"}).click();
  await page.getByRole("option",{name:"缓入缓出",exact:true}).click();
  await button("从 0.00 s 添加运镜").click();
  await button("接下一段").click();
  assert.equal(await head.inputValue(),"48");
  await button("预览本段").click();
  await button("暂停").click();
  await button("导出视频到画布").click();
  await button("导出到画布").click();
  await button("取消").click();
  // An interrupted project write can be retried without encoding or placing a second clip.
  let interrupted = false;
  await page.route(endpoint,route => {
    const req = route.request();
    if (!interrupted && req.method() === "PUT" && req.postDataJSON().nodes.some(n => n.data.kind === "video")) {
      interrupted = true;
      return route.fulfill({status:503,json:{error:"测试保存中断"}});
    }
    return route.continue();
  });
  await button("导出视频到画布").click();
  await button("导出到画布").click();
  await page.locator(".ds-export [role=alert]").waitFor({timeout:120000});
  assert.ok(interrupted);
  await button("导出到画布").click();
  await page.waitForFunction(() => !document.querySelector(".ds-export") || document.querySelector(".ds-export [role=alert]"),null,{timeout:120000});
  assert.equal(await page.locator(".ds-export [role=alert]").allTextContents().then(a => a.join(" ")),"");
  const saved = await (await page.request.get(endpoint)).json();
  assert.equal(saved.nodes.length,3);
  const clip = saved.nodes.find(n => n.data.kind === "video" && n.data.assetId);
  const target = saved.nodes.find(n => n.data.kind === "video" && !n.data.assetId);
  const scene = saved.nodes.find(n => n.id === node.id).data.stage;
  assert.equal(scene.objects[0].keys.length,3);
  assert.ok(scene.objects[1].keys.length>2);
  assert.deepEqual(saved.edges.map(e=>[e.source,e.target]),[[node.id,clip.id],[clip.id,target.id]]);
  const assets = await (await page.request.get(base+"api/assets")).json();
  const video = assets.find(a => a.id === clip.data.assetId);
  assert.equal(video.kind,"video");
  const model = {id:"with-video-input",mediaSlots:{video:1},optionalMedia:{video:true},maxRefs:0};
  assert.deepEqual(resolveWorkflowInputs(canvasInputs(saved,target,assets),target,assets,model).media.video.map(a=>a.id),[video.id]);
  const resp = await page.request.get(new URL(video.url,base).href);
  const bytes = await resp.body();
  assert.equal(bytes.toString("ascii",4,8),"ftyp");
  // Play the placed canvas node itself and compare decoded frames on both sides of a seek.
  const player = page.locator(".react-flow__node").filter({hasText:clip.data.title}).locator("video");
  await player.waitFor();
  assert.equal(await player.getAttribute("src"),video.url);
  const result = await player.evaluate(async movie => {
    movie.muted = true;
    await movie.play();
    movie.pause();
    const canvas = document.createElement("canvas"); canvas.width = 80; canvas.height = 45;
    const ctx = canvas.getContext("2d",{willReadFrequently:true});
    const pixels = () => { ctx.drawImage(movie,0,0,80,45); return ctx.getImageData(0,0,80,45).data; };
    const initial = pixels();
    const seeked = new Promise(resolve => { movie.onseeked = resolve; });
    movie.currentTime = movie.duration/2; await seeked;
    const next = pixels();
    return {size:[movie.videoWidth,movie.videoHeight],seconds:movie.duration,changed:initial.filter((p,i)=>Math.abs(p-next[i])>10).length};
  });
  assert.deepEqual(result.size,[1280,720]);
  assert.ok(Math.abs(result.seconds-scene.animation.endFrame/24)<.025);
  assert.ok(result.changed>250);
  assert.deepEqual(errors,[]);
  if (process.env.DIRECTOR_VIDEO_QA) await writeFile(process.env.DIRECTOR_VIDEO_QA,bytes);
});
