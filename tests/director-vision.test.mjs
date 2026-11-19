import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import { makeNode } from "../shared/studio.js";

test("导演台按选图顺序向四种模型接口发送真实像素，预览和失败均不写入画布", async t => {
  process.env.STUDIO_DATA_DIR = await mkdtemp(path.join(tmpdir(),"stage-vision-"));
  t.after(() => rm(process.env.STUDIO_DATA_DIR,{force:true,recursive:true}));
  async function listen(app) {
    const server = app.listen(0,"127.0.0.1");
    await new Promise(done => server.once("listening",done));
    t.after(() => new Promise(done => server.close(done)));
    return "http://127.0.0.1:" + server.address().port;
  }
  const provider = express();
  provider.use(express.json({limit:"10mb"}));
  const camera = { type:"camera",name:"全景",position:[0,2,5],rotation:[-7,0,0],fov:40 };
  let reply = JSON.stringify({ objects:[camera] }), payload;
  provider.post("/{*path}",(req,res) => {
    payload = req.body;
    if (req.path.endsWith("/responses")) return res.json({status:"completed",output:[{content:[{type:"output_text",text:reply}]}]});
    if (req.path.endsWith("/messages")) return res.json({content:[{type:"text",text:reply}]});
    if (req.path.endsWith(":generateContent")) return res.json({candidates:[{finishReason:"STOP",content:{parts:[{text:reply}]}}]});
    res.json({choices:[{finish_reason:"stop",message:{content:reply}}]});
  });
  const baseUrl = await listen(provider);
  const { studioApi } = await import("../server/api.mjs");
  const base = await listen(studioApi());
  async function api(route,data) {
    const res = await fetch(base+"/api"+route,{ method:data ? "POST" : "GET",headers:{"content-type":"application/json"},body:JSON.stringify(data) });
    return {status:res.status,body:await res.json()};
  }
  const node = makeNode("stage",{x:0,y:0});
  const ids = ["operator","coast"];
  const images = ids.map((assetId,i) => makeNode("image",{x:i*100,y:0},{assetId,title:assetId}));
  const {body:board,status} = await api("/projects",{board:{name:"识图测试",nodes:[node,...images],edges:[],order:[]}});
  assert.equal(status,201,JSON.stringify(board));
  const route = "/projects/"+board.id+"/nodes/"+node.id+"/director-scene";
  const expected = await Promise.all(ids.map(id => readFile(new URL("../public/stills/"+id+".jpg",import.meta.url),"base64")));
  let profileId;
  for (const protocol of ["chat","responses","anthropic","gemini"]) {
    const profile = await api("/prompt-models",{name:protocol,model:"vision",protocol,baseUrl,key:"test"});
    assert.ok(profile.body.id);
    profileId = profile.body.id;
    const response = await api(route,{profileId,assetIds:ids,note:"取全景"});
    assert.equal(response.status,200,JSON.stringify(response.body));
    const { objects,cameraId,referenceIds } = response.body;
    assert.deepEqual(referenceIds,ids);
    assert.deepEqual(objects,[{...camera,id:cameraId}]);
    let bytes;
    if (protocol === "chat") bytes = payload.messages[1].content.slice(1).map(p => p.image_url.url.split(",")[1]);
    if (protocol === "responses") bytes = payload.input[0].content.slice(1).map(p => p.image_url.split(",")[1]);
    if (protocol === "anthropic") bytes = payload.messages[0].content.slice(0,-1).map(p => p.source.data);
    if (protocol === "gemini") bytes = payload.contents[0].parts.slice(1).map(p => p.inlineData.data);
    assert.ok(bytes.length === 2 && bytes.every((b,i) => b === expected[i]),protocol+" received the selected original pixels");
  }
  assert.equal((await api(route,{profileId,assetIds:["unknown"]})).status,400);
  assert.equal((await api(route,{profileId,assetIds:["coast","coast"]})).status,400);
  reply = "这是一张风景图";
  assert.equal((await api(route,{profileId,assetIds:ids})).status,502);
  reply = JSON.stringify({objects:[{...camera,position:[null,1,1]}]});
  assert.equal((await api(route,{profileId,assetIds:ids})).status,502);
  assert.deepEqual((await api("/projects/"+board.id)).body.nodes,board.nodes);
});
