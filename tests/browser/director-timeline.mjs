import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";
import { makeNode, shots } from "../../shared/studio.js";
import { keyObject, cutCamera } from "../../shared/stage-animation.js";
import { stageObject } from "../../shared/director-stage.js";

test("导演台跨轨框选、成组移动及删除，一步撤销与重做，参考图在窄屏和宽屏均不越界", async t => {
  const dir=await mkdtemp(path.join(tmpdir(),"studio-timeline-"));
  process.env.STUDIO_DATA_DIR=dir;
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const server=await createServer({server:{port:0,hmr:false},logLevel:"error"});
  await server.listen(); t.after(()=>server.close());
  const base=server.resolvedUrls.local[0];
  const browser=await chromium.launch({args:["--use-angle=swiftshader","--enable-unsafe-swiftshader"]});
  t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1450,height:860}});
  const errors=[]; page.on("pageerror",e=>errors.push(e.message));
  const node=makeNode("stage",{x:0,y:0},{title:"花园调度"});
  let scene=node.data.stage;
  const [actor,camera]=scene.objects;
  actor.name="行人"; camera.name="主机位";
  for (const frame of [0,24,48,96]) scene=keyObject(scene,actor.id,frame,{position:[frame/96,0,0]});
  for (const frame of [12,36,72]) scene=keyObject(scene,camera.id,frame,{position:[frame/96,1.5,4.8]});
  scene=cutCamera(scene,camera.id,72);
  scene.objects.push({...stageObject("prop"),shape:"bench",name:"长椅",position:[-1.2,0,-1],size:[1.75,.84,.62]});
  node.data.stage=scene;
  const refs=shots.map(([assetId,name],i)=>makeNode("image",{x:-410,y:i*228},{assetId,title:i===2?"超长参考图文件名".repeat(6):name}));
  const response=await page.request.post(base+"api/projects",{data:{board:{name:"导演台编辑回归",nodes:[node,...refs],edges:[],order:[]}}});
  const project=await response.json(); assert.equal(response.status(),201);
  const endpoint=base+"api/projects/"+project.id;
  const button = name=>page.getByRole("button",{name,exact:true});
  const key = (name,f)=>button(name+" 第 "+f+" 帧");
  const picks = page.locator('.ds-diamond[aria-pressed=true]');
  const head=page.getByLabel("时间轴播放头");
  const assets=await (await page.request.get(base+"api/assets")).json();
  for (const [id,w,h] of [["receiver",80,280],["dial",480,60]]) {
    const url=assets.find(asset=>asset.id===id).url;
    await page.route(new URL(url,base).href,r=>r.fulfill({contentType:"image/svg+xml",body:
      '<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'"><rect width="100%" height="100%" fill="teal"/></svg>'}));
  }
  await page.goto(base+"#project/"+project.id);
  await button("打开导演台").click(); await button("动画时间轴").click();

  await button("选中主机位的所有关键帧").click(); assert.equal(await picks.count(),3);
  await key("行人",24).click();
  await key("行人",48).click({modifiers:["Shift"]});
  assert.equal(await picks.count(),2);
  await key("主机位",36).click({modifiers:["Control"]});
  assert.equal(await picks.count(),3);
  await button("删除选中的 3 个关键帧").click();
  assert.equal(await key("行人",24).count(),0);
  await head.focus();
  await page.keyboard.press("Control+z");
  assert.equal(await picks.count(),3); assert.equal(await head.inputValue(),"36");
  await button("重做").click(); assert.equal(await key("主机位",36).count(),0);
  await button("撤销").click();

  const lanes=page.locator(".ds-rail");
  const a=await lanes.nth(1).boundingBox(), b=await lanes.nth(2).boundingBox();
  const x = f=>a.x+a.width*f/120;
  await page.mouse.move(x(8),a.y+2); await page.mouse.down();
  await page.mouse.move(x(51),b.y+b.height-2,{steps:7}); await page.mouse.up();
  assert.equal(await picks.count(),4);
  const mark=await key("行人",24).boundingBox();
  await page.mouse.move(mark.x+mark.width/2,mark.y+mark.height/2); await page.mouse.down();
  await page.mouse.move(x(28),mark.y+mark.height/2,{steps:5}); await page.mouse.up();
  for(const [name,f] of [["行人",28],["行人",52],["主机位",16],["主机位",40]]) assert.equal(await key(name,f).getAttribute("aria-pressed"),"true");
  await page.keyboard.press("Backspace"); assert.equal(await key("行人",28).count(),0);
  await page.keyboard.press("Meta+z"); assert.equal(await picks.count(),4);
  await button("撤销").click(); await key("行人",24).waitFor();
  await button("放大时间轴").click(); assert.ok(await page.locator(".ds-tracks").evaluate(el=>el.scrollWidth>el.clientWidth));
  await button("适应时间轴").click();
  if (process.env.DIRECTOR_EDIT_QA) await page.screenshot({path:path.join(process.env.DIRECTOR_EDIT_QA,"timeline-edit.png")});

  await button("多选").click(); await key("主机位",72).click();
  assert.equal(await picks.count(),5);
  await page.keyboard.press("Escape"); assert.equal(await picks.count(),0);
  await page.keyboard.press("Control+a"); assert.equal(await picks.count(),8);
  await page.keyboard.press("Delete"); assert.equal(await page.locator(".ds-diamond").count(),0);
  await button("返回画布").click(); await button("打开导演台").click();
  await button("撤销").click(); assert.equal(await picks.count(),8);
  await page.waitForFunction(()=>document.querySelector(".ds-status")?.textContent==="已保存");
  const saved=await (await page.request.get(endpoint)).json();
  assert.deepEqual(saved.nodes.find(n=>n.id===node.id).data.stage,project.nodes.find(n=>n.id===node.id).data.stage);
  await button("AI 识图搭景").click();
  await button("选择参考图 风暴前的灯塔").click();
  await button("选择参考图 接通频道").click();
  for (const width of [1450,390]) {
    await page.setViewportSize({width,height:width===390?690:860});
    const bounds=await page.locator(".ds-ref-grid").evaluate(grid=>{
      const inside=(inner,outer)=>inner.left>=outer.left-.6 && inner.right<=outer.right+.6 && inner.top>=outer.top-.6 && inner.bottom<=outer.bottom+.6;
      const cards=[...grid.querySelectorAll("button")];
      return {noHorizontalOverflow:grid.scrollWidth<=grid.clientWidth+1,
        contained:cards.every(card=>[...card.querySelectorAll("img,span,b")].every(el=>inside(el.getBoundingClientRect(),card.getBoundingClientRect()))),
        vertical:cards.every(card=>card.querySelector(".ds-ref-name").getBoundingClientRect().top>=card.querySelector("img").getBoundingClientRect().bottom-.6)};
    });
    assert.deepEqual(bounds,{noHorizontalOverflow:true,contained:true,vertical:true});
    if (width===390) {
      await button("下一页参考图").click();
      const last=button("选择参考图 最后一次呼叫");
      await last.click();
      assert.equal(await last.locator("b").textContent(),"3");
      const img=last.locator("img");
      await img.evaluate(el=>el.decode());
      assert.equal(await img.evaluate(el=>el.naturalWidth/el.naturalHeight),8);
      await button("上一页参考图").click();
      assert.equal(await button("选择参考图 接通频道").locator("b").textContent(),"2");
      assert.equal(await page.locator(".ds-ref-grid").evaluate(el=>el.scrollHeight<=el.clientHeight+1),true);
    }
    if (process.env.DIRECTOR_EDIT_QA && width===1450) await page.screenshot({path:path.join(process.env.DIRECTOR_EDIT_QA,"vision-grid.png")});
  }
  await button("取消").click();
  assert.ok(await page.locator(".director-stage").evaluate(el=>el.scrollWidth<=innerWidth));
  assert.deepEqual(errors,[]);
});
