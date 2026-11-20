import * as T from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { figure, cameraMarker } from "./figure";
import { propMesh, disposeMeshes as release } from "./props";
import { stageFrames } from "../../shared/director-stage";

import { switchOn } from "../../shared/stage-actions.js";

const rad = T.MathUtils.degToRad;
const rounded = n => Math.round(n * 100) / 100;
function readTransform(object) {
  return {
    position: object.position.toArray().map(n => rounded(T.MathUtils.clamp(n, -100, 100))),
    rotation: [object.rotation.x, object.rotation.y, object.rotation.z].map(n => rounded(T.MathUtils.radToDeg(n))),
  };
}
export function createViewport(host, { select, selectRailKey, walkPoint, transform, report, monitor }) {
  const renderer = new T.WebGLRenderer({ alpha: false, antialias: true });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFShadowMap;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const surface = renderer.domElement;
  surface.setAttribute("aria-label", "三维场景视窗");
  host.append(surface);
  const world = new T.Scene();
  const clear = new T.Color(0x22262a);
  world.background = clear;
  world.fog = new T.FogExp2(0x272c30, 0.043);
  const ambient = new T.HemisphereLight(0xfff6e9, 0x838d9c, 2.05);
  const key = new T.DirectionalLight(0xfff1dc, 2.45);
  key.position.set(-4, 7, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9 });
  key.shadow.normalBias = 0.018;
  const rim = new T.DirectionalLight(0xcddff5, 1.9);
  rim.position.set(3, 4, -4);
  world.add(ambient, key, rim);
  const floor = new T.Mesh(new T.PlaneGeometry(240, 240), new T.MeshStandardMaterial({ color: 0x373d42, roughness: 1 }));
  const solidFloor = floor.material;
  const contactShadow = new T.ShadowMaterial({ opacity: 0.28 });
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.012;
  floor.receiveShadow = true;
  const grid = new T.Mesh(new T.PlaneGeometry(160, 160), new T.ShaderMaterial({
    transparent: true, depthWrite: false,
    vertexShader: `varying vec3 where;
      void main() {
        vec4 point = modelMatrix * vec4(position, 1.0);
        where = point.xyz;
        gl_Position = projectionMatrix * viewMatrix * point;
      }`,
    fragmentShader: `varying vec3 where;
      float line(vec2 p) {
        vec2 dist = abs(fract(p - 0.5) - 0.5) / max(fwidth(p), vec2(0.0001));
        return 1.0 - min(min(dist.x, dist.y), 1.0);
      }
      void main() {
        float fade = 1.0 - smoothstep(4.0, 23.0, distance(cameraPosition, where));
        float opacity = (0.14 * line(where.xz * 2.0) + 0.18 * line(where.xz)) * fade;
        gl_FragColor = vec4(0.62, 0.69, 0.70, opacity);
      }`,
  }));
  grid.rotation.x = floor.rotation.x;
  world.add(floor, grid);
  const director = new T.PerspectiveCamera(36, 1, 0.04, 300);
  director.rotation.order = "YXZ";
  const shot = new T.PerspectiveCamera(34, 1, 0.04, 300);
  shot.rotation.order = "YXZ";
  const orbit = new OrbitControls(director, surface);
  orbit.minDistance = 0.5; orbit.maxDistance = 120;
  orbit.maxPolarAngle = Math.PI * 0.495;
  function reset() {
    director.position.set(3.25, 2.4, 5.6);
    orbit.target.set(0, 0.85, 0);
    orbit.update();
  }
  reset();
  const gizmo = new TransformControls(director, surface);
  gizmo.setSize(0.78);
  const helper = gizmo.getHelper();
  world.add(helper);
  const objects = new Map();
  const labelLayer = document.createElement("div");
  labelLayer.className = "ds-actor-labels";
  labelLayer.setAttribute("aria-hidden","true");
  host.append(labelLayer);
  const labels = new Map(), projected = new T.Vector3();
  function renderLabels(w,h,inset) {
    const enabled = mode === "director" && switchOn(stage,"labels");
    labelLayer.hidden = !enabled;
    if (!enabled) return;
    const viewportBounds = inset && host.getBoundingClientRect();
    for (const actor of stage.objects) {
      if (actor.type !== "actor") continue;
      let label = labels.get(actor.id);
      if (!label) {
        label = document.createElement("span"); labels.set(actor.id,label); labelLayer.append(label);
      }
      if (label.textContent !== actor.name) label.textContent = actor.name;
      const mesh = objects.get(actor.id);
      mesh.getObjectByName("head").getWorldPosition(projected);
      projected.y += .39 * actor.scale;
      projected.project(director);
      const x = (projected.x+1)*w/2, y = (1-projected.y)*h/2;
      const behindMonitor = inset && x + viewportBounds.left > inset.left && x + viewportBounds.left < inset.right &&
        y + viewportBounds.top > inset.top && y + viewportBounds.top < inset.bottom;
      label.hidden = !!actor.hidden || !!behindMonitor || Math.abs(projected.z)>1 || Math.abs(projected.x)>1 || Math.abs(projected.y)>1;
      label.style.left = x+"px"; label.style.top = y+"px";
    }
  }
  let rail = null;
  function setRail(camera) {
    if (rail) { world.remove(rail); release(rail); rail = null; }
    if (camera?.keys?.length) {
      rail = new T.Group();
      const keys = camera.keys[0].frame === 0 ? camera.keys : [{ ...camera,frame:0 },...camera.keys];
      const points = keys.map(k => new T.Vector3(...k.position));
      const ink = new T.LineBasicMaterial({color:0x8cdbcd,depthTest:false,transparent:true,opacity:.86});
      const path = new T.Line(new T.BufferGeometry().setFromPoints(points),ink);
      path.renderOrder = 3; rail.add(path);
      const bead = new T.SphereGeometry(.055,10,8);
      const material = new T.MeshBasicMaterial({color:0xcaf2e7,depthTest:false});
      keys.forEach((k,i) => {
        const knot = new T.Mesh(bead,material);
        knot.position.copy(points[i]); knot.userData = {cameraId:camera.id,frame:k.frame};
        knot.renderOrder = 4; rail.add(knot);
        if (camera.type !== "camera") return;
        const angles = new T.Euler(...k.rotation.map(rad),"YXZ");
        const aim = new T.Vector3(0,0,-.38).applyEuler(angles).add(points[i]);
        const tick = new T.Line(new T.BufferGeometry().setFromPoints([points[i],aim]),ink);
        tick.renderOrder = 3; rail.add(tick);
      });
      rail.visible = mode === "director" && switchOn(stage,"rail"); world.add(rail);
    }
    invalidate();
  }
  let stage, selected, mode, tool, bgUrl, bgMode, texture, disposed = false, scheduling = 0;
  function frameRail() {
    if (!rail) return;
    const bounds = new T.Box3().setFromObject(rail);
    for (const object of stage.objects) {
      if (object.type !== "camera") bounds.expandByObject(objects.get(object.id));
    }
    const sphere = bounds.getBoundingSphere(new T.Sphere());
    const aspect = Math.max(.1,host.clientWidth / Math.max(1,host.clientHeight));
    const halfAngle = Math.atan(Math.tan(rad(director.fov/2))*Math.min(1,aspect));
    const distance = Math.max(2,1.1*sphere.radius/Math.sin(halfAngle));
    orbit.maxDistance = Math.max(120,distance*1.25);
    director.far = Math.max(300,distance+sphere.radius*2);
    director.position.copy(sphere.center).addScaledVector(new T.Vector3(1.3,.9,1.1).normalize(),distance);
    orbit.target.copy(sphere.center); orbit.update(); invalidate();
  }
  function cropBackground(aspect) {
    if (!texture || bgMode !== "flat") return;
    const source = texture.image.width / texture.image.height;
    const width = Math.min(1, aspect / source), height = Math.min(1, source / aspect);
    texture.repeat.set(width, height);
    texture.offset.set((1 - width) / 2, (1 - height) / 2);
    texture.updateMatrix();
  }
  let exporting = false;
  function render() {
    if (!stage || disposed || exporting) return;
    const { clientWidth: w, clientHeight: h } = host;
    if (!w || !h) return;
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, w, h);
    cropBackground(mode === "camera" ? shot.aspect : w / h);
    let inset;
    if (mode === "camera") {
      renderer.setClearColor(0x101214);
      renderer.clear();
      const width = Math.min(w, h * shot.aspect), height = width / shot.aspect;
      const x = (w - width) / 2, y = (h - height) / 2;
      renderer.setScissorTest(true);
      renderer.setScissor(x, y, width, height);
      renderer.setViewport(x, y, width, height);
      renderer.render(world, shot);
      renderer.setScissorTest(false);
    } else {
      director.aspect = w / h;
      director.updateProjectionMatrix();
      renderer.render(world, director);
      inset = monitor?.()?.getBoundingClientRect();
      if (inset?.width && inset.height) {
        const area = host.getBoundingClientRect();
        const x = inset.left-area.left, y = area.bottom-inset.bottom;
        renderer.setScissorTest(true);
        renderer.setScissor(x,y,inset.width,inset.height);
        renderer.setViewport(x,y,inset.width,inset.height);
        showHelpers(false); cropBackground(shot.aspect);
        renderer.render(world,shot);
        showHelpers(true);
        renderer.setScissorTest(false);
        renderer.setViewport(0,0,w,h);
      }
    }
    renderLabels(w,h,inset);
  }
  function invalidate() {
    if (!disposed && !exporting && !scheduling) scheduling = requestAnimationFrame(() => { scheduling = 0; render(); });
  }
  orbit.addEventListener("change", invalidate);
  gizmo.addEventListener("change", invalidate);
  gizmo.addEventListener("objectChange", () => {
    if (gizmo.object?.userData.id === stage?.cameraId) {
      shot.position.copy(gizmo.object.position);
      shot.rotation.copy(gizmo.object.rotation);
    }
  });
  gizmo.addEventListener("dragging-changed", e => { orbit.enabled = mode !== "camera" && !e.value; });
  let gizmoUsed = false;
  gizmo.addEventListener("mouseDown", () => { gizmoUsed = true; });
  gizmo.addEventListener("mouseUp", () => {
    if (gizmo.object) transform(gizmo.object.userData.id, readTransform(gizmo.object));
  });
  let start;
  function down(e) { start = [e.clientX, e.clientY]; gizmoUsed = false; }
  function up(e) {
    if (mode === "camera" || e.button !== 0 || !start || gizmoUsed || Math.hypot(e.clientX-start[0], e.clientY-start[1]) > 4) return;
    const r = surface.getBoundingClientRect();
    const ray = new T.Raycaster();
    ray.setFromCamera(new T.Vector2((e.clientX-r.left)/r.width*2-1, 1-(e.clientY-r.top)/r.height*2), director);
    if (tool === "walk") {
      const actor = stage.objects.find(o => o.id === selected);
      const spot = new T.Vector3();
      if (actor && ray.ray.intersectPlane(new T.Plane(new T.Vector3(0,1,0),-actor.position[1]),spot))
        walkPoint(switchOn(stage,"snap") ? [Math.round(spot.x*2)/2,spot.y,Math.round(spot.z*2)/2] : spot.toArray());
      return;
    }
    if (rail?.visible) {
      const knot = ray.intersectObjects(rail.children.filter(o => o.isMesh),false)[0]?.object;
      if (knot) { selectRailKey(knot.userData.cameraId,knot.userData.frame); return; }
    }
    let hit = ray.intersectObjects([...objects.values()].filter(mesh => mesh.visible), true)[0]?.object;
    while (hit && !hit.userData.id) hit = hit.parent;
    if (hit) select(hit.userData.id);
  }
  surface.addEventListener("pointerdown", down, true);
  surface.addEventListener("pointerup", up);
  const observer = new ResizeObserver(() => {
    if (!exporting) renderer.setSize(host.clientWidth || 1, host.clientHeight || 1, false); invalidate();
  });
  observer.observe(host);
  let backgroundRevision = 0;
  function loadBackground(url, type) {
    const revision = ++backgroundRevision;
    bgUrl = url; bgMode = type; floor.material = solidFloor;
    texture?.dispose(); texture = null; world.background = clear;
    if (url) new T.TextureLoader().load(url, map => {
      if (disposed || backgroundRevision !== revision) { map.dispose(); return; }
      map.colorSpace = T.SRGBColorSpace;
      if (type !== "flat") map.mapping = T.EquirectangularReflectionMapping;
      floor.material = contactShadow;
      texture = map; world.background = map; invalidate();
    }, undefined, () => { if (!disposed && backgroundRevision === revision) report("背景图读取失败，请重新选择图片"); });
  }
  function showHelpers(enable) {
    grid.visible = enable && switchOn(stage,"grid");
    if (rail) rail.visible = enable && switchOn(stage,"rail");
    helper.visible = enable && !!gizmo.object;
    for (const item of stage.objects) if (item.type === "camera") objects.get(item.id).visible = enable && !item.hidden;
  }
  function update(next, active, view, action, background) {
    stage = next; selected = active; mode = view; tool = action;
    const keys = new Set(stage.objects.map(o => o.id));
    for (const [id, mesh] of objects) if (!keys.has(id)) {
      if (gizmo.object === mesh) gizmo.detach();
      world.remove(mesh); release(mesh); objects.delete(id); labels.get(id)?.remove(); labels.delete(id);
    }
    for (const item of stage.objects) {
      let mesh = objects.get(item.id);
      const signature = item.type + (item.shape || "") + (item.pose || "") + (item.color || "");
      if (mesh?.userData.signature !== signature) {
        if (mesh) {
          if (gizmo.object === mesh) gizmo.detach();
          world.remove(mesh); release(mesh);
        }
        mesh = item.type === "actor" ? figure(item.color, item.pose) : item.type === "prop" ? propMesh(item) : cameraMarker();
        mesh.userData = { id: item.id, signature };
        objects.set(item.id, mesh); world.add(mesh);
      }
      mesh.visible = !item.hidden;
      if (item.type === "actor") mesh.setGait(item.gait,item.actionPhase,item.joints);
      mesh.position.fromArray(item.position);
      mesh.rotation.set(...item.rotation.map(rad), "YXZ");
      if (item.type === "prop") mesh.scale.fromArray(item.size);
      else mesh.scale.setScalar(item.scale || 1);
      if (item.id === stage.cameraId) {
        shot.position.copy(mesh.position); shot.rotation.copy(mesh.rotation);
        const [w, h] = stageFrames[stage.ratio];
        shot.aspect = w / h; shot.fov = item.fov; shot.updateProjectionMatrix();
      }
    }
    if (bgUrl !== background || bgMode !== stage.backgroundMode) loadBackground(background, stage.backgroundMode);
    floor.visible = switchOn(stage,"floor");
    world.backgroundRotation.y = stage.backgroundId && stage.backgroundMode !== "flat" ? rad(stage.panoramaYaw || 0) : 0;
    gizmo.setTranslationSnap(switchOn(stage,"snap") ? .5 : null);
    orbit.enabled = mode !== "camera";
    if (orbit.enabled && (tool === "translate" || tool === "rotate") && objects.get(selected)?.visible && !stage.objects.find(o=>o.id===selected)?.locked) {
      gizmo.setMode(tool);
      if (gizmo.object !== objects.get(selected)) gizmo.attach(objects.get(selected));
    } else gizmo.detach();
    showHelpers(orbit.enabled);
    invalidate();
  }
  function frameSubjects(ids, size, cameraId) {
    world.updateMatrixWorld(true);
    const corners = [];
    const bounds = new T.Box3();
    for (const id of ids) {
      const mesh = objects.get(id);
      if (!mesh || !mesh.visible) continue;
      const box = new T.Box3().setFromObject(mesh);
      const height = box.max.y-box.min.y;
      if (size === "medium") box.min.y += height*.43;
      if (size === "close") {
        box.min.y += height*.69;
        const head = mesh.getObjectByName("head");
        if (head) {
          const face = new T.Box3().setFromObject(head).getCenter(new T.Vector3());
          const half = height*.12;
          box.min.x=face.x-half; box.max.x=face.x+half;
          box.min.z=face.z-half; box.max.z=face.z+half;
        }
      }
      bounds.union(box);
      for (const x of [box.min.x,box.max.x]) for (const y of [box.min.y,box.max.y])
        for (const z of [box.min.z,box.max.z]) corners.push(new T.Vector3(x,y,z));
    }
    if (!corners.length) throw Error("请先添加要拍摄的角色");
    const center = bounds.getCenter(new T.Vector3());
    const rotation = objects.get(cameraId).quaternion;
    const inverse = rotation.clone().invert();
    const slope = Math.tan(rad(stage.objects.find(o => o.id === cameraId).fov/2));
    let distance = .2;
    for (const point of corners) {
      point.sub(center).applyQuaternion(inverse);
      distance = Math.max(distance,point.z+1.1*Math.max(Math.abs(point.x)/(slope*shot.aspect),Math.abs(point.y)/slope));
    }
    const position = center.add(new T.Vector3(0,0,distance).applyQuaternion(rotation)).toArray();
    if (position.some(n => Math.abs(n)>100)) throw Error("此构图超出机位范围，请缩小队形或调宽视角");
    return {position:position.map(rounded)};
  }
  function subjectsInFrame() {
    shot.updateMatrixWorld(true);
    world.updateMatrixWorld(true);
    const frustum = new T.Frustum().setFromProjectionMatrix(new T.Matrix4().multiplyMatrices(shot.projectionMatrix,shot.matrixWorldInverse));
    const percent = n => Math.round(T.MathUtils.clamp(n,0,1)*100);
    return stage.objects.filter(o => o.type === "actor" && !o.hidden).flatMap(actor => {
      const box = new T.Box3().setFromObject(objects.get(actor.id));
      if (!frustum.intersectsBox(box)) return [];
      const point = box.getCenter(new T.Vector3()).project(shot);
      return [{id:actor.id, x:percent((point.x+1)/2), y:percent((1-point.y)/2)}];
    });
  }
  function capture() {
    if (!stage || (bgUrl && !texture)) throw Error("场景还未就绪，请等图片载入后再拍摄");
    const [w, h] = stageFrames[stage.ratio];
    const pixelRatio = renderer.getPixelRatio();
    try {
      showHelpers(false);
      renderer.setPixelRatio(1); renderer.setSize(w, h, false);
      renderer.setScissorTest(false); renderer.setViewport(0, 0, w, h);
      cropBackground(shot.aspect);
      renderer.render(world, shot);
      return new Promise((resolve, reject) => surface.toBlob(blob => blob ? resolve(blob) : reject(Error("机位截图失败")), "image/png"));
    } finally {
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(host.clientWidth || 1, host.clientHeight || 1, false);
      showHelpers(mode !== "camera"); render();
    }
  }
  function beginVideo(w,h) {
    if (!stage || (bgUrl && !texture)) throw Error("背景图还未载入，请稍后再导出");
    const original = {stage,selected,mode,tool,bgUrl,pixelRatio:renderer.getPixelRatio()};
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d",{willReadFrequently:true});
    if (!ctx) throw Error("无法读取三维画面");
    exporting = true;
    renderer.setPixelRatio(1); renderer.setSize(w,h,false);
    return {
      pixels(next) {
        if (disposed || renderer.getContext().isContextLost()) throw Error("三维视窗已关闭或中断，请重新导出");
        update(next,null,"camera","orbit",original.bgUrl);
        renderer.setScissorTest(false); renderer.setViewport(0,0,w,h); cropBackground(shot.aspect);
        renderer.render(world,shot);
        ctx.drawImage(surface,0,0);
        return ctx.getImageData(0,0,w,h).data;
      },
      restore() {
        exporting = false;
        if (disposed) return;
        renderer.setPixelRatio(original.pixelRatio);
        renderer.setSize(host.clientWidth || 1,host.clientHeight || 1,false);
        update(original.stage,original.selected,original.mode,original.tool,original.bgUrl); render();
      },
    };
  }
  function contextLost(e) { e.preventDefault(); report("三维显示已中断，请关闭并重新打开导演台"); }
  surface.addEventListener("webglcontextlost", contextLost);
  return {
    update, reset, capture, frameSubjects, subjectsInFrame, setRail, frameRail, beginVideo,
    previewAction(id, phase) {
      if (exporting || disposed) return;
      const actor = stage?.objects.find(o=>o.id===id && o.type==="actor");
      if (!actor) return;
      objects.get(id).setGait(phase == null ? actor.gait : null,phase ?? actor.actionPhase,actor.joints);
      invalidate();
    },
    cameraFromDirector: () => ({ ...readTransform(director), fov: director.fov }),
    dispose() {
      disposed = true; cancelAnimationFrame(scheduling); observer.disconnect();
      surface.removeEventListener("webglcontextlost", contextLost);
      surface.removeEventListener("pointerdown", down, true); surface.removeEventListener("pointerup", up);
      gizmo.detach(); world.remove(helper); gizmo.dispose(); orbit.dispose();
      floor.material = solidFloor; contactShadow.dispose(); release(world); texture?.dispose(); key.shadow.dispose(); renderer.dispose(); renderer.forceContextLoss(); surface.remove(); labelLayer.remove();
    },
  };
}
