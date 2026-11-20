import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";
import { makeNode } from "../../shared/studio.js";
import { panoramaModelId } from "../../shared/image-actions.js";

test("选图制作三视图与全景，正反拖线可在视频卡片或素材上松开", async t => {
  const dir = await mkdtemp(path.join(tmpdir(),"studio-image-actions-"));
  process.env.STUDIO_DATA_DIR=dir;
  t.after(() => rm(dir,{recursive:true,force:true}));
  const server = await createServer({server:{port:0,strictPort:false,hmr:false},logLevel:"error"});
  t.after(() => server.close()); await server.listen();
  const base = server.resolvedUrls.local[0];
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({viewport:{width:1440,height:880}});
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror",e => errors.push(e.message));
  await page.route("**/api/engine",route=>route.fulfill({json:{online:true,imageModels:[
    {id:"qwen",name:"Qwen Image",family:"qwen21",maxRefs:3},
    {id:panoramaModelId,name:"360° 全景扩图",workflow:true,maxRefs:1,mediaSlots:{image:1},fields:[],controls:[]}
  ],videoModels:[{id:"i2v",name:"参考图生视频",needsImage:true,maxRefs:1}]}}));
  const pic = makeNode("image",{x:0,y:0},{title:"公园",assetId:"coast"});
  const other = makeNode("image",{x:0,y:360},{title:"人物",assetId:"operator"});
  const video = makeNode("video",{x:650,y:0},{title:"镜头"});
  const replacement = makeNode("image",{x:0,y:680},{title:"替代人物",assetId:"receiver"});
  const res = await page.request.post(base+"api/projects",{data:{board:{name:"节点工具",nodes:[pic,video,other,replacement],edges:[],order:[]}}});
  assert.equal(res.status(),201);
  const board = await res.json(), endpoint = base+"api/projects/"+board.id, url=base+"#project/"+board.id;
  const read = async()=> (await page.request.get(endpoint)).json();
  const button = name=>page.getByRole("button",{name,exact:true});
  const tile = id=>page.locator('.react-flow__node[data-id="'+id+'"] .flow-tile-face');
  const composer = page.locator(".composer-anchor");
  const saved = async()=>page.waitForFunction(()=>document.querySelector(".flow-status")?.textContent==="已保存");
  async function drag(from,to) {
    const a = await from.boundingBox(), b = await to.boundingBox();
    await page.mouse.move(a.x+a.width/2,a.y+a.height/2);
    await page.mouse.down();
    await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:22});
    await page.locator('[data-wire-target="video"]').waitFor();
    assert.equal(await composer.count(),0,"拉线时收起节点编辑器");
    await page.mouse.up();
    assert.equal(await composer.count(),0,"连好后等到点选节点才打开编辑器");
  }
  await page.goto(url);
  await tile(pic.id).waitFor();
  await tile(pic.id).click();
  await composer.waitFor();
  await drag(button("公园 · 添加下游"),tile(video.id));
  await page.waitForFunction(()=>document.querySelectorAll(".react-flow__edge-path").length===1);
  await saved();
  const wired = (await read()).nodes.find(n=>n.id===video.id);
  assert.equal(wired.data.videoModel,"i2v");
  assert.equal(wired.data.text,"@图1");
  await drag(button("镜头 · 添加上游"),tile(other.id));
  await page.waitForFunction(()=>document.querySelectorAll(".react-flow__edge-path").length===2);
  await saved();
  const edge = (await read()).edges.find(e => e.source === pic.id && e.target === video.id);
  const point = await page.locator('.react-flow__edge[data-id="'+edge.id+'"] .react-flow__edge-path').evaluate(path=>{
    const p = path.getPointAtLength(path.getTotalLength()*.5).matrixTransform(path.getScreenCTM());
    return {x:p.x,y:p.y};
  });
  await page.mouse.click(point.x,point.y);
  const anchor = page.locator(".react-flow__edgeupdater-source");
  await anchor.waitFor();
  await drag(anchor,tile(replacement.id));
  await saved();
  const swapped = await read();
  assert.equal(swapped.edges.find(e => e.id === edge.id).source,replacement.id);
  assert.equal(swapped.edges.length,2);
  const data = swapped.nodes.find(n=>n.id===video.id).data;
  assert.deepEqual(data.imageRefOrder,[replacement.id,other.id]);
  assert.equal(data.text,"@图1 @图2");
  const submissions = [];
  const job = {id:crypto.randomUUID(),status:"running"};
  await page.route("**/api/projects/*/generate", async route => {
    submissions.push({request:route.request().postDataJSON(),board:await read()});
    await route.fulfill({status:202,json:{id:job.id}});
  });
  const jobResponse = route => route.fulfill({json:[job]});
  await page.route("**/nodes/*/jobs?job=*", jobResponse);
  await page.route("**/api/jobs?*ids=*", jobResponse);
  await page.route("**/stills/operator.jpg", route => route.fulfill({contentType:"image/svg+xml",
    body:'<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="red"/><rect x="150" width="100" height="200" fill="gold"/><rect x="250" width="100" height="200" fill="blue"/></svg>'}));
  await page.goto(url+"?node="+pic.id);
  await tile(pic.id).click();
  await button("制作三视图").click();
  await page.locator(".flow-tile.chosen .flow-label").filter({hasText:"三视图"}).waitFor();
  await composer.waitFor();
  await saved();
  const turnaround = (await read()).nodes.find(n=>n.data.imageTask==="turnaround");
  assert.equal(turnaround.data.imageModel,"qwen");
  assert.match(turnaround.data.text,/正面.*侧面.*背面/u);
  assert.equal(submissions.length,0);

  await tile(pic.id).click();
  const pendingSaved = page.waitForResponse(r=>r.url().endsWith("/api/projects/"+board.id) &&
    r.request().method()==="PUT" && r.request().postDataJSON().nodes.some(n=>n.data.pendingCanvasJob===job.id));
  await button("制作全景图").click();
  await page.locator(".flow-tile-face[aria-busy=true]").waitFor();
  assert.equal(await composer.count(),0);
  await pendingSaved;
  const [{request,board:atSubmission}] = submissions;
  const panorama = atSubmission.nodes.find(n=>n.id===request.nodeId);
  assert.equal(request.revision,atSubmission.revision);
  assert.equal(request.checkpoint,panoramaModelId);
  assert.equal(panorama.data.imageModel,panoramaModelId);
  assert.deepEqual(panorama.data.customSize,{width:2048,height:1024});
  assert.equal(panorama.data.canvasRef,pic.id);
  assert.ok(atSubmission.edges.some(e=>e.source===pic.id && e.target===panorama.id));
  await page.goto(url);
  await page.reload();
  await tile(panorama.id).locator(".tile-generation").waitFor();
  Object.assign(job,{status:"done",assetId:"operator",nodeId:panorama.id});
  const viewer = tile(panorama.id).locator(".panorama-viewer[data-status=ready]");
  await viewer.waitFor();
  assert.equal(submissions.length,1);
  assert.equal(await composer.count(),0);
  const centerColor = viewer => viewer.locator("canvas").evaluate(canvas =>
    [...canvas.getContext("2d").getImageData(canvas.width >> 1,canvas.height >> 1,1,1).data].slice(0,3));
  const gold = [255,215,0], blue = [0,0,255], red = [255,0,0];
  assert.deepEqual(await centerColor(viewer),gold);
  const bounds = await viewer.boundingBox(), cy = bounds.y + bounds.height / 2;
  await page.mouse.move(bounds.x + bounds.width * .9, cy);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * .1, cy, {steps:16});
  await page.mouse.up();
  await page.evaluate(()=>new Promise(requestAnimationFrame));
  assert.deepEqual(await centerColor(viewer),blue);
  assert.equal(await composer.count(),0);
  const afterDrag = await viewer.boundingBox();
  assert.ok(Math.abs(bounds.x-afterDrag.x)<1 && Math.abs(bounds.y-afterDrag.y)<1);

  await tile(panorama.id).getByRole("button",{name:/放大预览/}).click();
  const expanded = page.locator("dialog[open] .panorama-viewer[data-status=ready]");
  await expanded.waitFor();
  await expanded.focus();
  for (let quarter=0; quarter<4; quarter++) {
    for (let i=0; i<3; i++) await page.keyboard.press("Shift+ArrowRight");
    await page.evaluate(()=>new Promise(requestAnimationFrame));
    assert.deepEqual(await centerColor(expanded),[blue,red,red,gold][quarter]);
  }
  await page.keyboard.press("Escape");
  await expanded.waitFor({state:"hidden"});
  assert.deepEqual(errors,[]);
});
