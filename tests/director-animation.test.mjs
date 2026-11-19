import test from "node:test";
import assert from "node:assert/strict";
import { newStage, stageObject, validStage } from "../shared/director-stage.js";
import { keyObject, sampleStage, moveMarker, cutCamera } from "../shared/stage-animation.js";
import { applyStagePlan, stageIsUntouched } from "../shared/stage-references.js";

test("导演台采样角色走位、短弧旋转、姿势和镜头视角，切镜在指定帧生效", () => {
  const initial = newStage();
  assert.ok(validStage(initial));
  assert.ok(stageIsUntouched(initial));
  const [actor, camera] = initial.objects;
  const other = stageObject("camera", 1);
  let scene = { ...initial, objects:[actor,camera,other] };
  scene = keyObject(scene, actor.id, 0, { rotation:[0,170,0] });
  scene = keyObject(scene, actor.id, 24, { position:[4,0,-2], rotation:[0,-170,0], pose:"walking", scale:2 });
  scene = keyObject(scene, camera.id, 24, { fov:54 });
  scene = cutCamera(scene, other.id, 18);
  assert.ok(validStage(scene));
  const half = sampleStage(scene,12);
  assert.deepEqual(half.objects[0].position,[2,0,-1]);
  assert.equal(Math.abs(half.objects[0].rotation[1]),180);
  assert.equal(half.objects[0].scale,1.5);
  assert.equal(half.objects[0].pose,"standing");
  assert.equal(half.objects[1].fov,44);
  assert.equal(half.cameraId,camera.id);
  assert.equal(sampleStage(scene,18).cameraId,other.id);
  assert.equal(sampleStage(scene,24).objects[0].pose,"walking");
  assert.deepEqual(sampleStage(scene,120).objects[0].position,[4,0,-2]);
  assert.ok(!stageIsUntouched(scene));
  assert.deepEqual(initial.objects[0],actor);
  const moved = moveMarker(scene,actor.id,24,48);
  assert.deepEqual(moved.objects[0].keys.map(k => k.frame),[0,48]);
  assert.deepEqual(moveMarker(moved,actor.id,48,0),moved);
  assert.deepEqual(moveMarker(moved,actor.id,48,null).objects[0].keys.map(k => k.frame),[0]);
  assert.deepEqual(moveMarker(scene,"cuts",18,8).animation.cuts,[{frame:8,cameraId:other.id}]);
  assert.equal(validStage({...scene,animation:{endFrame:8,cuts:[]}}),false);
  assert.equal(validStage({...scene,animation:{endFrame:120,cuts:[{frame:2,cameraId:actor.id}]}}),false);
  const draft = { ...newStage(), referenceIds:["coast"] };
  assert.deepEqual(applyStagePlan(initial,draft,true).objects,draft.objects);
  const appended = applyStagePlan(scene,draft,true);
  assert.deepEqual(appended.objects.slice(0,3),scene.objects);
  assert.deepEqual(appended.animation,scene.animation);
  assert.equal(appended.cameraId,camera.id);
});

import { addCameraMove, cameraMoves, usesAngle, isOrbit } from "../shared/stage-camera.js";
test("运镜轨道生成可编辑的机位关键帧，保护已有镜头，绕拍保持主体与镜头间距", () => {
  const stage = newStage(), camera = stage.objects[1], actor = stage.objects[0];
  for (const move of Object.keys(cameraMoves)) {
    const options = {move,start:90,frames:48,amount:usesAngle(move) ? 45 : 1,targetId:actor.id};
    const result = addCameraMove(stage,camera.id,options);
    assert.ok(validStage(result),move);
    assert.equal(result.animation.endFrame,138);
    const keys = result.objects[1].keys;
    assert.deepEqual(keys[0].position,camera.position);
    assert.equal(keys.at(-1).frame,138);
    if (isOrbit(move)) for (const k of keys) assert.ok(Math.abs(Math.hypot(k.position[0],k.position[2])-4.8)<.001);
    if (move === "push") assert.ok(keys.at(-1).position[2] < camera.position[2]);
    if (move === "pan") assert.equal(keys.at(-1).rotation[1],-45);
    assert.throws(() => addCameraMove(result,camera.id,options),/已有关键帧/);
    const next = addCameraMove(result,camera.id,{...options,start:138});
    assert.ok(validStage(next));
    assert.deepEqual(next.objects[1].keys.filter(k => k.frame === 138),keys.slice(-1));
  }
});
