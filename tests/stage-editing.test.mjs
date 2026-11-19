import test from "node:test";
import assert from "node:assert/strict";
import { newStage } from "../shared/director-stage.js";
import { keyObject, cutCamera } from "../shared/stage-animation.js";
import { editMarkers } from "../shared/stage-markers.js";
import { stageHistory, recordStage, replayStage } from "../src/director/stage-history.js";

test("关键帧批量操作在越界或冲突时保留所有轨道；允许同时移动相邻的选中帧",()=>{
  let scene=newStage();
  const id=scene.objects[0].id;
  for(const f of [12,24,48]) scene=keyObject(scene,id,f);
  scene=cutCamera(scene,scene.cameraId,24);
  const selection=[{track:id,frame:12},{track:id,frame:24},{track:"cuts",frame:24}];
  assert.throws(()=>editMarkers(scene,selection,24,120),/已有关键帧/);
  assert.throws(()=>editMarkers(scene,selection,-13,120),/不能移出/);
  const moved=editMarkers(scene,selection,12,120);
  assert.deepEqual(moved.objects[0].keys.map(k=>k.frame),[24,36,48]);
  assert.equal(moved.animation.cuts[0].frame,36);
  assert.deepEqual(scene.objects[0].keys.map(k=>k.frame),[12,24,48]);
  assert.equal(scene.animation.cuts[0].frame,24);
});

test("撤销后修改产生新分支，同一次输入合并为一步",()=>{
  const initial=newStage(), second={...initial,ratio:"9:16"}, third={...initial,ratio:"4:3"};
  const input=Symbol();
  recordStage(initial,second,{frame:2},"输入",input);
  recordStage(second,third,{frame:3},"输入",input);
  assert.equal(stageHistory(third).past.length,1);
  const restored=replayStage(third,{frame:4},false);
  assert.equal(restored.stage,initial); assert.deepEqual(restored.context,{frame:2});
  assert.equal(stageHistory(initial).future.length,1);
  const branch={...initial,ratio:"1:1"};
  recordStage(initial,branch,{frame:5},"画幅");
  assert.equal(replayStage(branch,{},true),null);
});
