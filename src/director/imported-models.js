import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import { inspectStageModel } from "../../shared/stage-model";
import { disposeMeshes } from "./props";

export async function parseStageModel(buffer, name) {
  const {format} = inspectStageModel(new Uint8Array(buffer),name);
  const manager = new T.LoadingManager().setURLModifier(url => {
    if (/^(blob:|data:)/i.test(url)) return url;
    throw Error("请选择资源全部内嵌的模型");
  });
  let scene, animations;
  if (format === "obj") {
    scene = new OBJLoader(manager).parse(new TextDecoder().decode(buffer));
    animations = [];
  } else {
    ({scene,animations} = await new GLTFLoader(manager).parseAsync(buffer,""));
  }
  const bounds = new T.Box3().setFromObject(scene,true);
  const size = bounds.getSize(new T.Vector3());
  if (bounds.isEmpty() || !Number.isFinite(size.length()) || size.length() <= 1e-6) {
    disposeStageModel({scene});
    throw Error("模型文件没有可显示的几何体");
  }
  return {scene,animations,bounds,size};
}

export function disposeStageModel({scene}) {
  const textures = new Set();
  scene.traverse(object => {
    object.skeleton?.dispose();
    for (const material of [object.material].flat().filter(Boolean))
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
  });
  disposeMeshes(scene);
  for (const texture of textures) {
    texture.image?.close?.();
    texture.dispose();
  }
}

export function placeStageModel(model,item) {
  const root = new T.Group(), anchor = new T.Group();
  const visual = clone(model.scene);
  visual.traverse(child => { if (child.isMesh) { child.castShadow = true; child.receiveShadow = true; } });
  const {bounds,size} = model;
  const scale = item.type === "actor" && size.y > 1e-6 ? 1.83/size.y : 1/Math.max(size.x,size.y,size.z);
  const center = bounds.getCenter(new T.Vector3());
  anchor.scale.setScalar(scale);
  anchor.position.set(-center.x*scale,-bounds.min.y*scale,-center.z*scale);
  root.add(anchor); anchor.add(visual);
  const clip = model.animations[item.modelClip];
  const mixer = clip && new T.AnimationMixer(visual);
  if (mixer) {
    mixer.clipAction(clip).play();
    root.setModelTime = seconds => mixer.setTime(seconds);
  }
  root.removeModel = () => {
    mixer?.stopAllAction();
    visual.traverse(child => child.skeleton?.dispose());
    root.remove(anchor);
  };
  return root;
}
