import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";
import { makeNode } from "../../shared/studio.js";
import { panoramaModelId } from "../../shared/image-actions.js";
import { restoreModelId } from "../../shared/image-restore.js";

test("旧全景连续修复后仍能同视角环视、独立拖线、放大并用于导演台", async t => {
  const dir = await mkdtemp(path.join(tmpdir(),"restored-panorama-"));
  process.env.STUDIO_DATA_DIR = dir;
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const vite = await createServer({server:{port:0,hmr:false},logLevel:"error"});
  await vite.listen(); t.after(()=>vite.close());
  const base= vite.resolvedUrls.local[0];
  const browser=await chromium.launch({args:["--use-angle=swiftshader","--enable-unsafe-swiftshader"]});
  t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1300,height:780},reducedMotion:"reduce"});
  page.setDefaultTimeout(8000);
  const errors=[]; page.on("pageerror",e=>errors.push(e.message));
  const out=makeNode("image",{x:0,y:0},{title:"全景修复结果",assetId:"operator",imageModel:restoreModelId});
  const res=await page.request.post(base+"api/projects",{data:{board:{name:"360 修复",nodes:[out],edges:[],order:[]}}});
  const board=await res.json(), job={project:board.id,type:"image",status:"done",created:new Date().toISOString()};
  await writeFile(path.join(dir,"jobs.json"),JSON.stringify([
    {...job,id:"second",modelId:restoreModelId,inputAssetIds:["receiver"],assetId:"operator"},
    {...job,id:"first",detail:"高清修复 · 细节增强 25% · 长边 3072 px",inputAssetIds:["coast"],assetId:"receiver"},
    {...job,id:"pano",modelId:panoramaModelId,assetId:"coast"},
  ]));
  const assets=await (await page.request.get(base+"api/assets")).json();
  for (const [id,source] of [["operator","receiver"],["receiver","coast"],["coast",undefined]]) {
    const asset=assets.find(a=>a.id===id);
    assert.equal(asset.panorama,true); assert.equal(asset.restoreSourceId,source);
  }
  assert.ok(!assets.find(a=>a.id==="flare").panorama);
  // Different raster sizes and colours on each side make misaligned projections detectable.
  for (const [id,size,center,side] of [["operator",900,"gold","blue"],["receiver",450,"lime","red"]]) {
    await page.route("**/stills/"+id+".jpg",route=>route.fulfill({contentType:"image/svg+xml",
      body:'<svg xmlns="http://www.w3.org/2000/svg" width="'+size+'" height="'+size/2+'" viewBox="0 0 400 200"><rect width="400" height="200" fill="'+side+'"/><rect x="150" width="100" height="200" fill="'+center+'"/></svg>'}));
  }
  await page.route("**/api/engine",route=>route.fulfill({json:{online:false}}));
  const endpoint=base+"api/projects/"+board.id;
  await page.goto(base+"#project/"+board.id+"?node="+out.id);
  const tile=page.locator('.react-flow__node[data-id="'+out.id+'"]');
  const colors=viewer=>viewer.locator("canvas").evaluateAll(canvases=>canvases.map(c=>
    [...c.getContext("2d").getImageData(c.width>>1,c.height>>1,1,1).data].slice(0,3)));
  const paint=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const viewer=tile.locator(".panorama-viewer"), split=tile.getByRole("slider",{name:"修复前后对比"});
  await split.waitFor(); assert.deepEqual(await colors(viewer),[[255,215,0],[0,255,0]]);
  const rect=await viewer.boundingBox(), y=rect.y+rect.height/2;
  await page.mouse.move(rect.x+rect.width*.58,y); await page.mouse.down();
  await page.mouse.move(rect.x+rect.width*.05,y,{steps:7}); await page.mouse.up(); await paint();
  assert.deepEqual(await colors(viewer),[[0,0,255],[255,0,0]]);
  assert.equal(await split.getAttribute("aria-valuenow"),"72");
  const grip=await split.boundingBox(); await page.mouse.move(grip.x+grip.width/2,y);
  await page.mouse.down(); await page.mouse.move(rect.x+rect.width*.3,y,{steps:5}); await page.mouse.up(); await paint();
  assert.ok(Number(await split.getAttribute("aria-valuenow"))<35);
  assert.deepEqual(await colors(viewer),[[0,0,255],[255,0,0]]);
  assert.equal(await tile.getByRole("link",{name:"下载图片"}).getAttribute("href"),"/stills/operator.jpg");
  await tile.getByRole("button",{name:/放大预览/}).click();
  const dialog=page.locator("dialog.reference-viewer"), big=dialog.locator(".panorama-viewer");
  await dialog.getByRole("slider").waitFor(); await dialog.getByRole("button",{name:"2×"}).click();
  await big.focus();
  for(let n=0;n<3;n++) await page.keyboard.press("Shift+ArrowRight");
  await paint(); assert.deepEqual(await colors(big),[[0,0,255],[255,0,0]]);
  await page.keyboard.press("Home"); await paint(); assert.deepEqual(await colors(big),[[255,215,0],[0,255,0]]);
  const size=await big.boundingBox(); assert.ok(size.width>900 && size.height>450);
  await page.keyboard.press("Escape"); await dialog.waitFor({state:"detached"});
  await tile.locator(".flow-label").click();
  await page.getByRole("button",{name:"搭景",exact:true}).click();
  await page.getByRole("dialog",{name:"3D 导演台"}).waitFor();
  await page.waitForFunction(()=>document.querySelector(".ds-status")?.textContent==="已保存");
  const updated=await (await page.request.get(endpoint)).json();
  const stage=updated.nodes.find(n=>n.data.kind==="stage").data.stage;
  assert.equal(stage.backgroundMode,"panorama"); assert.equal(stage.backgroundId,"operator");
  assert.deepEqual(errors,[]);
});
