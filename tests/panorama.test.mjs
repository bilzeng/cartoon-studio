import test from "node:test";
import assert from "node:assert/strict";
import { panoramaPreset, qwenPanoramaPreset } from "../server/presets/panorama.mjs";
import { bindPreset } from "../server/workflow-presets.mjs";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { imageActionData, panoramaLoraFile } from "../shared/image-actions.js";
import { panoramaReference } from "../server/panorama-reference.mjs";

test("制作全景图默认使用千问 2.1，制作三视图使用通用编辑模型", () => {
  const source = {id:"ref",data:{title:"搭景"}};
  const editor = {id:"qwen",family:"qwen21",maxRefs:4};
  const preset = {id:qwenPanoramaPreset.id,workflow:true,maxRefs:1};
  const missing = {...preset,dependencies:[{value:"missing.safetensors",choices:[]}]};
  const action = (mode,models) => imageActionData(mode,source,models);
  assert.equal(action("panorama",[missing,editor]).imageModel,preset.id);
  assert.equal(action("panorama",[editor,{...preset,id:panoramaPreset.id},preset]).imageModel,preset.id);
  assert.equal(action("turnaround",[preset,editor]).imageModel,editor.id);
  assert.equal(action("panorama",[]).imageModel,preset.id);
  assert.deepEqual(action("panorama",[preset]).customSize,{width:2048,height:1024});
});

test("2.1 全景采样器按安装情况串接专用 LoRA", () => {
  const file = "qwen/"+panoramaLoraFile;
  for (const panoramaLora of [null,file]) {
    const {graph,preparePanoramaRef} = bindPreset(qwenPanoramaPreset,{fields:[],needsImage:true,panoramaLora});
    assert.equal(preparePanoramaRef,true);
    assert.equal(graph[4].class_type,"TextEncodeQwenImage21");
    assert.equal(graph[100].inputs.image,"{{image1}}");
    assert.deepEqual(graph[4].inputs["images.image_1"],["100",0]);
    assert.equal(graph[8].inputs.cfg,1);
    assert.equal(graph[8].inputs.steps,25);
    assert.deepEqual(graph[8].inputs.model,panoramaLora ? ["panoramaLora",0] : ["1",0]);
    if (panoramaLora) assert.deepEqual(graph.panoramaLora.inputs,{model:["1",0],lora_name:file,strength_model:0.8});
    else assert.equal(graph.panoramaLora,undefined);
  }
});

test("全景参考图前方保留原景，两端和极点留给模型补画", async () => {
  const png = await panoramaReference(fileURLToPath(new URL("../public/stills/coast.jpg",import.meta.url)));
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
  assert.deepEqual([width,height],[2048,1024]);
  const rgb = execFileSync("ffmpeg",["-loglevel","error","-i","pipe:0","-frames:v","1","-f","rawvideo","-pix_fmt","rgb24","pipe:1"],
    {input:png,maxBuffer:width*height*3+1024});
  const pixel = (x,y) => [...rgb.subarray(3*(y*width+x),3*(y*width+x)+3)];
  const green = [0,255,0];
  for (const [x,y] of [[0,height/2],[width-1,height/2],[width/2,0],[width/2,height-1]]) assert.deepEqual(pixel(x,y),green);
  assert.notDeepEqual(pixel(width/2,height/2),green);
});

test("全景图从实际参考图生成，接缝在画面中央修补后回到原方位", () => {
  const {graph} = bindPreset(panoramaPreset,{fields:[],needsImage:true});
  assert.equal(graph.source.inputs.image,"{{image1}}");
  assert.equal(graph.layout.inputs.prompt,"{{prompt}}");
  const {width,height} = graph.latent.inputs;
  assert.deepEqual([width,height],panoramaPreset.bindings.outputSize);
  assert.equal(width,2*height);
  assert.equal(graph.seam.inputs.x+graph.strip.inputs.width/2,width/2);
  assert.deepEqual(graph.repaired.inputs.mask,["seam",0]);
  assert.deepEqual(graph.repaired.inputs.destination,["wrapped",0]);
  for (const [prefix,input] of [["wrapped","panorama"],["final","repaired"]]) {
    assert.deepEqual(graph[prefix+"Right"].inputs.image,[input,0]);
    assert.equal(graph[prefix+"Right"].inputs.x,width/2);
    assert.equal(graph[prefix+"Left"].inputs.x,0);
    assert.deepEqual(graph[prefix+"Start"].inputs.source,[prefix+"Right",0]);
    assert.deepEqual(graph[prefix].inputs.source,[prefix+"Left",0]);
  }
  assert.deepEqual(graph.out.inputs.images,["final",0]);
  for (const node of Object.values(graph))
    for (const link of Object.values(node.inputs).filter(Array.isArray))
      assert.ok(graph[link[0]],"未连接的节点 "+link[0]);
});
