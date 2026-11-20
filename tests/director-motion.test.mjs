import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { newStage, validStage } from "../shared/director-stage.js";
import { sampleStage, walkTo, keyObject } from "../shared/stage-animation.js";
import { addCameraMove } from "../shared/stage-camera.js";
import { makeNode } from "../shared/studio.js";
import { placeStageVideo } from "../shared/director-output.js";
import { canvasInputs, resolveWorkflowInputs } from "../shared/canvas.js";
import { figure } from "../src/director/figure.js";

const worldPosition = (mesh,name) => mesh.getObjectByName(name).getWorldPosition(new Vector3());

test("左右手的奇幻战锤握在柄上，站立时锤头朝角色前方", () => {
  const mesh = figure("#a08974","standing","round",{left:"fantasyHammer",right:"fantasyHammer"});
  mesh.rotation.y = .62;
  const forward = new Vector3(0,0,1).applyQuaternion(mesh.quaternion);
  for (const side of ["left","right"]) {
    const prop = mesh.getObjectByName(side+"-grip").children[0];
    const hand = worldPosition(mesh,side+"-hand");
    assert.ok(prop.localToWorld(new Vector3(0,.23,0)).distanceTo(hand) < 1e-6);
    assert.ok(prop.localToWorld(new Vector3(0,.82,0)).sub(hand).dot(forward) > .4);
    assert.ok(prop.localToWorld(new Vector3()).sub(hand).dot(forward) < 0);
  }
});

test("三个新武打预设在时间轴上分别呈现高位扫腿、交替出手和双掌蓄势", () => {
  function preview(pose,frames) {
    const original = newStage(), actor = original.objects[0];
    const stage = keyObject(original,actor.id,8,{pose});
    assert.ok(validStage(stage));
    assert.equal(sampleStage(stage,7).objects[0].pose,"standing");
    const mesh = figure(actor.color,pose);
    return frames.map(frame => {
      const sampled = sampleStage(stage,8+frame).objects[0];
      assert.equal(sampled.pose,pose);
      mesh.setGait(sampled.gait,sampled.actionPhase,sampled.joints);
      return ["left-foot","right-foot","left-hand","right-hand"].map(name => worldPosition(mesh,name));
    });
  }
  const [[lead,base],[follow],[rest]] = preview("highWhipKick",[22,29,54]);
  assert.ok(lead.y > 1.45 && base.y < .1);
  assert.ok(Math.abs(lead.x-follow.x) > .3);
  assert.ok(rest.y < .1);
  const [[,,leftGuard,rightForward],[,,leftForward,rightGuard]] = preview("wingChun",[7,17]);
  assert.ok(rightForward.z-leftGuard.z > .15 && leftForward.z-rightGuard.z > .15);
  const [[,,leftUp,rightUp],[,,leftOut,rightOut]] = preview("dragonPalms",[21,32]);
  assert.ok(leftUp.y > 1.65 && rightUp.y > 1.65);
  assert.ok(leftOut.z > leftUp.z+.12 && rightOut.z > rightUp.z+.12);
});

test("连续落点按距离和步速排帧，落脚、摆臂、转弯，停止时恢复站姿", () => {
  const original = newStage(), id = original.objects[0].id;
  const first = walkTo(original,id,0,[0,0,2],1);
  assert.equal(first.end,48);
  const next = walkTo(first.stage,id,48,[2,0,2],2);
  assert.equal(next.end,72);
  assert.ok(validStage(next.stage));
  assert.deepEqual(next.stage.objects[0].keys.map(k=>k.frame),[0,48,72]);
  assert.throws(()=>walkTo(next.stage,id,0,[0,0,3],1),/已有角色关键帧/);
  assert.throws(()=>walkTo(original,id,2879,[0,0,3]),/120/);
  const actor = f => sampleStage(next.stage,f).objects[0];
  assert.ok(actor(46).rotation[1] > 0 && actor(46).rotation[1] < 90);
  assert.equal(actor(54).rotation[1],90);
  assert.equal(actor(72).gait,undefined);
  assert.deepEqual(actor(90).position,[2,0,2]);
  const mesh = figure("#a08974","standing");
  const joints = () => mesh.children.map(part=>part.position.toArray());
  const rest = joints();
  mesh.setGait(actor(11).gait); const mid = joints();
  mesh.setGait(actor(20).gait);
  assert.ok(joints().filter((pos,i)=>Math.abs(pos[2]-mid[i][2])>.03).length>=8);
  mesh.setGait(null);
  for (const [i,pos] of joints().entries()) pos.forEach((n,j)=>assert.ok(Math.abs(n-rest[i][j])<1e-8));
  const legacy = keyObject(original,id,36,{position:[1,0,0]});
  assert.ok(sampleStage(legacy,13).objects[0].gait);
  const still = keyObject(original,id,36,{rotation:[0,45,0]});
  assert.equal(sampleStage(still,13).objects[0].gait,undefined);
});

test("运镜空间路径与速度曲线独立，推轨变焦在各关键帧保持主体画幅", () => {
  const stage = newStage(), id = stage.cameraId, camera = stage.objects[1];
  camera.rotation = [0,0,0];
  const move = (name,easing="linear") => addCameraMove(stage,id,{move:name,start:0,frames:48,amount:1,targetId:stage.objects[0].id,easing});
  const depth = (name,frame) => camera.position[2]-sampleStage(move("push",name),frame).objects[1].position[2];
  assert.ok(depth("easeIn",12)<depth("linear",12));
  assert.ok(depth("smooth",12)<depth("linear",12));
  assert.ok(depth("easeOut",12)>depth("linear",12));
  for (const easing of ["linear","easeIn","easeOut","smooth"]) assert.ok(Math.abs(depth(easing,48)-1)<.0001);
  const travel = move("sTravel");
  assert.ok(sampleStage(travel,12).objects[1].position[0]>0);
  assert.ok(sampleStage(travel,36).objects[1].position[0]<0);
  const zoom = move("dollyZoom","smooth");
  const projection = c => c.position[2]*Math.tan(c.fov*Math.PI/360);
  for (const key of zoom.objects[1].keys) assert.ok(Math.abs(projection(key)-projection(camera))<.0001);
  assert.ok(validStage(zoom));
});

test("视频可只放到画布，也能接入已有节点并保留已有视频引用", () => {
  const stage = makeNode("stage",{x:0,y:0}), source = makeNode("video",{x:0,y:260},{assetId:"old"});
  const target = makeNode("video",{x:900,y:0},{text:"跟随 @视频1 的人物"});
  const board = {series:{},nodes:[stage,source,target],edges:[{id:"old-link",source:source.id,target:target.id}],order:[]};
  const asset = {id:"rehearsal",kind:"video"}, assets = [asset,{id:"old",kind:"video"}];
  const only = placeStageVideo(board,stage.id,asset,"only");
  assert.equal(only.board.nodes.length,4); assert.equal(only.board.edges.length,2);
  const placed = placeStageVideo(board,stage.id,asset,target.id);
  const destination = placed.board.nodes.find(n => n.id === target.id);
  assert.equal(destination.data.text,"跟随 @视频1 的人物 @视频2");
  for (const optional of [false,true]) {
    const model = {id:"video",mediaSlots:{video:2},optionalMedia:{video:optional},maxRefs:0};
    const inputs = resolveWorkflowInputs(canvasInputs(placed.board,destination,assets),destination,assets,model);
    assert.deepEqual(inputs.media.video.map(a=>a.id),["old","rehearsal"]);
  }
  assert.equal(board.nodes.length,3); assert.equal(target.data.text,"跟随 @视频1 的人物");
});

test("动作随时间重复，关节在同一姿态内插值，旧关键帧会还原关节", () => {
  let stage = newStage();
  const actor = stage.objects[0];
  stage = keyObject(stage,actor.id,8,{pose:"waving",joints:{rightArm:30}});
  stage = keyObject(stage,actor.id,23,{joints:{rightArm:60}});
  const wave = frame=>sampleStage(stage,frame).objects[0];
  assert.equal(wave(7).pose,"standing");
  assert.equal(wave(13).joints.rightArm,40);
  assert.equal(wave(23).actionPhase,.5);
  assert.equal(wave(38).actionPhase,0);
  const mesh=figure(actor.color,"waving");
  mesh.setGait(null,0,{rightArm:30});
  const still=mesh.children.map(c=>c.position.toArray());
  mesh.setGait(null,.25,{rightArm:30});
  assert.ok(mesh.children.some((c,i)=>c.position.toArray().some((x,j)=>Math.abs(x-still[i][j])>.015)));
  delete stage.objects[0].keys[1].joints;
  assert.deepEqual(wave(23).joints,{});
  assert.ok(validStage(stage));
  stage.objects[0].keys[1].joints={rightArm:350};
  assert.ok(!validStage(stage));
});

test("连续跑步落点保留跑姿，停步恢复站立，挥手走位保留上身动作", () => {
  const scene = newStage(), actor = scene.objects[0];
  const first = walkTo(scene,actor.id,0,[0,0,3],3);
  const next = walkTo(first.stage,actor.id,first.end,[2,0,3],3);
  for (const f of [4,first.end+4]) assert.equal(sampleStage(next.stage,f).objects[0].pose,"running");
  assert.equal(sampleStage(next.stage,next.end).objects[0].pose,"standing");
  const wave = walkTo(keyObject(scene,actor.id,0,{pose:"waving"}),actor.id,0,[0,0,2]);
  const moving = sampleStage(wave.stage,7).objects[0];
  assert.equal(moving.pose,"waving");
  assert.ok(moving.gait && moving.actionPhase > 0);
});
