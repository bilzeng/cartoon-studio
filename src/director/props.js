import * as T from "three";
import { propCatalog } from "../../shared/stage-props.js";

export function propMesh({shape,color}) {
  const group = new T.Group();
  const base = new T.Color(color);
  const shade = base.clone().multiplyScalar(.64);
  const light = base.clone().lerp(new T.Color("#e5dfd1"),.26);
  function part(geometry, size, x, y, z, tone = base) {
    const mesh = new T.Mesh(geometry,new T.MeshStandardMaterial({color:tone,roughness:.82}));
    mesh.scale.fromArray(size);
    mesh.position.set(x,y,z);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  }
  // Coordinates are expressed in the model's unit box. The y argument is the bottom of a part.
  function box(w,h,d,x,y,z,tone) {
    return part(new T.BoxGeometry(1,1,1),[w,h,d],x,y+h/2,z,tone);
  }
  function cylinder(w,h,d,x,y,z,tone) {
    return part(new T.CylinderGeometry(.5,.5,1,24),[w,h,d],x,y+h/2,z,tone);
  }
  function outline(points, thickness, tone = light) {
    const face = new T.Shape();
    face.moveTo(...points[0]);
    for (const point of points.slice(1)) face.lineTo(...point);
    face.closePath();
    return part(new T.ExtrudeGeometry(face, { depth: thickness, bevelEnabled: false }),[1,1,1],0,0,-thickness/2,tone);
  }
  function legs(w,h,d,x,z) {
    for (const side of [-1,1]) for (const end of [-1,1]) box(w,h,d,x*side,0,z*end,shade);
  }
  switch (shape) {
    case "table":
      box(1,.09,1,0,.91,0); legs(.065,.91,.09,.425,.40); break;
    case "chair":
      legs(.09,.46,.09,.39,.39); box(1,.08,.97,0,.46,0);
      for (const x of [-.40,.40]) box(.09,.46,.09,x,.54,-.39,shade);
      box(.92,.23,.08,0,.76,-.39); break;
    case "sofa":
      box(.91,.23,.87,0,.09,0,shade); legs(.065,.11,.09,.39,.35);
      for (const x of [-.20,.20]) box(.39,.19,.79,x,.32,.055,light);
      box(.85,.57,.17,0,.43,-.40);
      for (const x of [-.45,.45]) box(.1,.38,.94,x,.27,0); break;
    case "bookcase":
      for (const x of [-.475,.475]) box(.05,1,1,x,0,0);
      for (const y of [0,.32,.65,.97]) box(.92,.03,1,0,y,0);
      for (const [i,x] of [-.35,-.25,-.18,.07,.17].entries()) box(.064,.18 + i%3*.025,.68,x,.35,-.04,i%2 ? shade : light);
      for (const x of [.12,.22,.32]) box(.075,.22,.7,x,.68,0,shade); break;
    case "wall": box(1,1,1,0,0,0); break;
    case "doorway":
      for (const x of [-.46,.46]) box(.08,.95,1,x,0,0);
      box(1,.05,1,0,.95,0); break;
    case "window":
      for (const x of [-.47,0,.47]) box(.045,.94,.8,x,.03,0);
      for (const y of [0,.5,.95]) box(1,.05,1,0,y,0); break;
    case "stairs":
      for (let i=0;i<6;i++) box(1,(i+1)/6,1/6,0,0,.5-(i+.5)/6); break;
    case "tree":
      cylinder(.12,.61,.13,0,0,0,"#766351");
      for (const [x,y,z,s,tone] of [[-.19,.64,.04,.60,shade],[.17,.69,-.07,.62,base],[0,.81,.07,.6,light]])
        part(new T.IcosahedronGeometry(.5,1),[s,s*.62,s],x,y,z,tone);
      break;
    case "bench":
      for (const x of [-.37,.37]) {
        box(.07,.17,.87,x,0,0,shade); box(.06,.44,.10,x,.13,-.3,shade); box(.06,.8,.07,x,.14,-.41,shade);
      }
      for (const z of [-.24,.02,.28]) box(1,.075,.225,0,.47,z);
      for (const y of [.66,.87]) box(1,.13,.09,0,y,-.38); break;
    case "lamp":
      cylinder(.57,.075,.57,-.16,0,0,shade); cylinder(.13,.87,.15,-.16,.06,0);
      box(.67,.035,.12,.11,.90,0); cylinder(.57,.055,.7,.21,.945,0,shade);
      cylinder(.53,.035,.66,.21,.91,0,"#e5d5a3"); break;
    case "straightSword":
    case "propDagger":
      cylinder(.21,.23,.7,0,0,0,shade); box(.94,.065,.82,0,.22,0);
      outline([[-.24,.27],[.24,.27],[.23,.76],[0,1],[-.23,.76]],.42);
      outline([[0,.29],[.09,.69],[0,.95],[-.09,.69]],.44,base); break;
    case "curvedBlade":
      cylinder(.18,.23,.7,-.09,0,0,shade); box(.65,.055,.80,-.09,.22,0,base);
      outline([[-.27,.26],[.06,.26],[.21,.63],[.47,.87],[.38,1],[.10,.91],[-.2,.66]],.45); break;
    case "stageStaff":
      cylinder(.74,1,.74,0,0,0);
      for (const y of [0,.44,.52,.95]) cylinder(.93,.045,.93,0,y,0,shade);
      break;
    case "stageSpear":
    case "stageHalberd":
      cylinder(.14,.87,.68,0,0,0,"#836349"); box(.25,.057,.82,0,.76,0,shade);
      outline([[-.23,.82],[0,.99],[.23,.82],[0,.78]],.52);
      if (shape === "stageHalberd") outline([[.07,.78],[.38,.80],[.49,.94],[.50,.82],[.35,.73],[.08,.73]],.46);
      break;
    case "moonShield": {
      const disc = (radius, depth, z, tone) => {
        const mesh = part(new T.CylinderGeometry(radius,radius,depth,32),[1,1,1],0,.5,z,tone);
        mesh.rotation.x = Math.PI/2;
      };
      disc(.5,.48,0,shade); disc(.43,.25,.27,base); disc(.125,.16,.43,light);
      break;
    }
    case "fantasyHammer":
      cylinder(.19,.78,.55,0,0,0,shade);
      part(new T.IcosahedronGeometry(.5,0),[1,.31,1],0,.82,0);
      box(.62,.09,.84,0,.76,0,light); break;
    case "sphere": part(new T.SphereGeometry(.5,28,18),[1,1,1],0,.5,0); break;
    case "cylinder": cylinder(1,1,1,0,0,0); break;
    default: box(1,1,1,0,0,0);
  }
  return group;
}
export function disposeMeshes(group) {
  const geometries = new Set(), materials = new Set();
  group.traverse(o => {
    if (o.geometry) geometries.add(o.geometry);
    if (o.material) for (const m of [].concat(o.material)) materials.add(m);
  });
  geometries.forEach(g => g.dispose());
  materials.forEach(m => m.dispose());
}
export function modelPreviews(entries, build, {width=160,height=100,elevation=2} = {}) {
  const images = {};
  const renderer = new T.WebGLRenderer({alpha:true,antialias:true});
  try {
    renderer.setSize(width,height,false);
    const aspect = width/height;
    const world = new T.Scene();
    world.add(new T.HemisphereLight(0xfff5e6,0x919ba5,2.2));
    const sun = new T.DirectionalLight(0xffedcc,2.0);
    sun.position.set(-3,5,4); world.add(sun);
    for (const [id,preset] of entries) {
      const model = build(id,preset);
      world.add(model);
      const bounds = new T.Box3().setFromObject(model), center = bounds.getCenter(new T.Vector3());
      const camera = new T.OrthographicCamera(-aspect,aspect,1,-1,.01,50);
      camera.position.copy(center).add(new T.Vector3(3,elevation,4)); camera.lookAt(center);
      camera.updateMatrixWorld();
      const fit = new T.Box3();
      for (const x of [bounds.min.x,bounds.max.x]) for (const y of [bounds.min.y,bounds.max.y]) for (const z of [bounds.min.z,bounds.max.z])
        fit.expandByPoint(new T.Vector3(x,y,z).applyMatrix4(camera.matrixWorldInverse));
      camera.zoom = .88 / Math.max(fit.max.x/aspect, -fit.min.x/aspect, fit.max.y, -fit.min.y);
      camera.updateProjectionMatrix();
      renderer.render(world,camera);
      images[id] = renderer.domElement.toDataURL("image/png");
      world.remove(model); disposeMeshes(model);
    }
    return images;
  } finally { renderer.dispose(); renderer.forceContextLoss(); }
}

let previews;
export function propPreviews() {
  return previews ??= modelPreviews(Object.entries(propCatalog),(shape,p) => {
    const model = propMesh({shape,color:p.color});
    model.scale.fromArray(p.size);
    return model;
  });
}
