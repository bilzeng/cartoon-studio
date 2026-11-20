import test from "node:test";
import assert from "node:assert/strict";
import {createServer as createHttpServer} from "node:http";
import {once} from "node:events";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {chromium} from "playwright";
import {createServer} from "vite";
import {makeNode} from "../../shared/studio.js";

test("超时后重连原 ComfyUI 队列，保留卡片动效并下载指定输出", async t => {
  const dir = await mkdtemp(path.join(tmpdir(),"studio-job-recovery-"));
  process.env.STUDIO_DATA_DIR = dir;
  t.after(() => rm(dir,{recursive:true,force:true}));
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRq8AAAAASUVORK5CYII=","base64");
  let done = false;
  const requests = [];
  const comfy = createHttpServer((req,res) => {
    const url = new URL(req.url,"http://localhost");
    requests.push([req.method,url.pathname,url.searchParams.get("filename"),req.headers.authorization]);
    if (url.pathname === "/history/original") return res.end(JSON.stringify(done ? {
      original:{status:{completed:true},outputs:{first:{images:[{filename:"preview.png"}]},final:{images:[{filename:"final.png"}]}}},
    } : {}));
    if (url.pathname === "/queue") return res.end(JSON.stringify({queue_running:[],queue_pending:[[0,"another"],[1,"original"]]}));
    if (url.pathname === "/view" && url.searchParams.get("filename") === "final.png") return res.end(png);
    res.writeHead(404).end();
  });
  comfy.listen(0,"127.0.0.1"); await once(comfy,"listening");
  t.after(() => comfy.close());
  const origin = "http://127.0.0.1:"+comfy.address().port;
  const vite = await createServer({server:{port:0,strictPort:false,hmr:false},logLevel:"error"});
  t.after(() => vite.close());
  await vite.listen();
  const base = vite.resolvedUrls.local[0];
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({viewport:{width:1440,height:900}});
  const node = makeNode("image",{x:0,y:0},{title:"待恢复镜头",text:"快照"});
  const created = await page.request.post(base+"api/projects",{data:{
    board:{name:"恢复结果",nodes:[node],edges:[],order:[]},
  }});
  assert.equal(created.status(),201);
  const {id} = await created.json();
  const {changeJobs} = await import("../../server/storage.mjs");
  const {saveEnvironment} = await import("../../server/environments.mjs");
  await saveEnvironment(origin,"原环境","fixture-token");
  await saveEnvironment("http://127.0.0.1:1","当前环境","");
  const now = new Date().toISOString();
  await changeJobs(rows => rows.push({
    id:"expired",project:id,nodeId:node.id,type:"image",title:"待恢复镜头",status:"failed",phase:"executing",
    detail:"等待超过 60 分钟，请在 ComfyUI 历史中检查结果",created:now,finishedAt:now,
    environment:origin,promptId:"original",recovery:{output:"final",seed:42},
  }));
  await page.goto(base+"#project/"+id);
  const tile = page.locator('.react-flow__node[data-id="'+node.id+'"]');
  await tile.click();
  await page.getByRole("button",{name:"重连取回",exact:true}).click();
  await tile.getByText("ComfyUI 排队第 2 位").waitFor();
  const aura = tile.locator(".tile-generation");
  await aura.waitFor();
  assert.equal(await aura.evaluate(el => getComputedStyle(el,"::before").animationName),"tile-generation-drift");
  done = true;
  await tile.getByRole("img",{name:"待恢复镜头 · 42",exact:true}).waitFor({timeout:12000});
  const replay = await page.request.post(base+"api/jobs/expired/recover");
  assert.equal(replay.status(),200);
  const result = await replay.json();
  assert.equal(result.status,"done");
  assert.equal(result.recovered,true);
  assert.deepEqual(requests.filter(([method]) => method === "POST"),[]);
  assert.deepEqual(requests.filter(([,route]) => route === "/view").map(request => request.slice(2)),[["final.png","Bearer fixture-token"]]);
  const assets = await (await page.request.get(base+"api/assets")).json();
  const asset = assets.find(a => a.id === result.assetId);
  assert.deepEqual(await (await page.request.get(new URL(asset.url,base).href)).body(),png);
});
