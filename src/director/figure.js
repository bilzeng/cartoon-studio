import * as T from "three";
import { actionPresets } from "../../shared/stage-actions.js";

// Local coordinates use metres, with the soles on the ground and the face toward +Z.
export function figure(color, pose) {
  const group = new T.Group();
  const shell = new T.MeshStandardMaterial({ color, roughness: 0.62 });
  const joint = new T.MeshStandardMaterial({ color: new T.Color(color).multiplyScalar(0.5), roughness: 0.85 });
  const unit = new T.SphereGeometry(1, 24, 16);
  function oval(x, y, z, w, h, d, material = shell) {
    const mesh = new T.Mesh(unit, material);
    mesh.position.set(x, y, z);
    mesh.scale.set(w, h, d);
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  }
  function shellProfile(points, y, depth) {
    const shape = new T.LatheGeometry(points.map(([r, h]) => new T.Vector2(r, h)), 36);
    const mesh = new T.Mesh(shape, shell);
    mesh.position.y = y;
    mesh.scale.z = depth;
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  }
  const axis = new T.Vector3(0,1,0), direction = new T.Vector3();
  function link(part, a, b, radius) {
    direction.set(b[0]-a[0],b[1]-a[1],b[2]-a[2]);
    part.position.set((a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2);
    part.scale.y = direction.length()/2+radius*.32;
    part.quaternion.setFromUnitVectors(axis,direction.normalize());
  }
  function limb(a,b,radius,depth=radius) {
    const part = oval(0,0,0,radius,1,depth);
    link(part,a,b,radius);
    return part;
  }
  const seated = pose === "seated", kneeling = pose === "kneeling" || pose === "halfKneel", crouching = pose === "crouching";
  const step = pose === "walking" || pose === "running";
  const offset = seated ? -.43 : kneeling ? -.40 : crouching ? -.50 : 0;
  const rest = actionPresets[pose]?.angles || {};
  const radians = T.MathUtils.degToRad;
  shellProfile([[0,0],[0.082,0.024],[0.16,0.076],[0.177,0.13],[0.162,0.19],[0.126,0.22],[0,0.22]], 0.84 + offset, 0.78);
  oval(0, 1.13 + offset, 0, 0.14, 0.14, 0.102, joint);
  shellProfile([[0,0],[0.123,0.008],[0.153,0.069],[0.194,0.16],[0.21,0.225],[0.205,0.259],[0.158,0.291],[0.074,0.317],[0,0.32]], 1.18 + offset, 0.69);
  oval(0, 1.53 + offset, 0, 0.068, 0.088, 0.068, joint);
  const head = shellProfile([[0,0],[0.052,0.01],[0.079,0.042],[0.103,0.098],[0.111,0.169],[0.106,0.218],[0.085,0.254],[0.049,0.275],[0,0.28]], 1.551 + offset, 1.02);
  head.name = "head";
  const neck = new T.Group();
  neck.position.copy(head.position);
  const nose = oval(0, 1.684 + offset, 0.118, 0.018, 0.026, 0.021);
  for (const part of [head,nose]) { part.position.sub(neck.position); neck.add(part); }
  group.add(neck);
  const torso = new T.Group();
  const waistHeight = .918 + offset;
  for (const part of group.children.slice()) { part.position.y -= waistHeight; torso.add(part); }
  group.add(torso);
  const torsoRotation = new T.Euler(0,0,0,"YXZ"), atWaist = new T.Vector3();
  const animateSides = [];
  for (const sign of [-1, 1]) {
    const hip = [0.103 * sign, 0.918 + offset, 0];
    const knee = [0.113 * sign, seated ? 0.47 : 0.5, seated ? 0.39 : step ? 0.17 * sign + 0.055 : 0.018];
    const ankle = [0.13 * sign, step && sign < 0 ? 0.17 : 0.105, seated ? 0.40 : step ? 0.31 * sign : -0.025];
    if (kneeling) { knee.splice(1,2,.085,.09); ankle.splice(1,2,.105,-.33); }
    if (pose === "halfKneel" && sign === 1) { knee.splice(1,2,.52,.43); ankle.splice(1,2,.105,.43); }
    if (crouching) { knee.splice(1,2,.23,.34); ankle.splice(1,2,.105,-.035); }
    const thigh = limb(hip, knee, 0.096, 0.10);
    const kneecap = oval(...knee, 0.07, 0.071, 0.07, joint);
    const shin = limb(knee, ankle, 0.074);
    const foot = oval(ankle[0], ankle[1] - 0.047, ankle[2] + 0.069, 0.07, 0.057, 0.143);
    const shoulder = [0.204 * sign, 1.423 + offset, 0];
    let elbow = [0.255 * sign, 1.16 + offset, step ? -0.10 * sign : 0.013];
    let wrist = [0.27 * sign, 0.905 + offset, step ? -0.23 * sign + 0.07 : 0.075];
    if (seated) wrist = [0.16 * sign, 0.57, 0.29];
    if (pose === "waving" && sign === -1) { elbow = [-.42,1.57,.02]; wrist = [-.41,1.82,.10]; }
    if (pose === "hips") { elbow = [.41*sign,1.20,.035]; wrist = [.18*sign,1.025,.045]; }
    if (pose === "thinking" && sign === 1) { elbow = [.25,1.20,.17]; wrist = [.077,1.56,.145]; }
    if (pose === "pointing" && sign === -1) {
      elbow = [-0.40, 1.41, 0.17]; wrist = [-0.56, 1.43, 0.35];
    } else if (pose === "listening" && sign === 1) {
      elbow = [0.35, 1.33, 0.11]; wrist = [0.13, 1.68, 0.08];
    }
    const socket = oval(...shoulder, 0.079, 0.081, 0.078);
    const arm = limb(shoulder, elbow, 0.063);
    const elbowJoint = oval(...elbow, 0.048, 0.05, 0.048, joint);
    const forearm = limb(elbow, wrist, 0.054);
    const hand = oval(...wrist, 0.044, 0.069, 0.037);
    const side = sign === 1 ? "left" : "right";
    const upper = new T.Quaternion(), lower = new T.Quaternion(), euler = new T.Euler();
    const mid = new T.Vector3(), tip = new T.Vector3();
    function articulate(root, hinge, end, lift, spread, bend) {
      if (!lift && !spread && !bend) return;
      upper.setFromEuler(euler.set(-radians(lift),0,sign*radians(spread),"ZXY"));
      lower.setFromEuler(euler.set(-radians(bend),0,0));
      mid.set(hinge[0]-root[0],hinge[1]-root[1],hinge[2]-root[2]).applyQuaternion(upper);
      tip.set(end[0]-hinge[0],end[1]-hinge[1],end[2]-hinge[2]).applyQuaternion(lower).applyQuaternion(upper);
      for (const [i,axis] of ["x","y","z"].entries()) {
        hinge[i] = root[i]+mid[axis]; end[i] = hinge[i]+tip[axis];
      }
    }
    animateSides.push((gait,bob,value,beat) => {
      const t = ((gait?.phase || 0)+(sign>0 ? .5 : 0))%1, w = gait?.weight || 0;
      const swing = Math.max(0,Math.sin((t-.5)*2*Math.PI));
      const stride = gait?.stride || 1;
      // Stance moves the supporting foot back at the body's travel speed.
      const excursion = t < .5 ? .25-t : -.25+(1-Math.cos((t-.5)*2*Math.PI))*.25;
      const mix = (a,b) => a+(b-a)*w;
      const h = [hip[0],hip[1]+bob,0];
      const a = [ankle[0],mix(ankle[1],.105+(pose === "running" ? .26 : .15)*swing),mix(ankle[2],stride*excursion)];
      const dy = a[1]-h[1], dz = a[2]-h[2], reach = Math.hypot(dy,dz);
      const bend = Math.sqrt(Math.max(0,.445**2-(reach/2)**2));
      const k = [knee[0],mix(knee[1],(a[1]+h[1])/2+bend*dz/reach),
        mix(knee[2],(a[2]+h[2])/2-bend*dy/reach)];
      articulate(h,k,a,value(side+"Hip"),0,-value(side+"Knee"));
      link(thigh,h,k,.096); link(shin,k,a,.074); kneecap.position.fromArray(k);
      foot.position.set(a[0],a[1]-.047,a[2]+.069);
      const sh = [shoulder[0],shoulder[1]+bob,0];
      const swingArm = ["standing","walking","running"].includes(pose);
      const e = [elbow[0],elbow[1]+bob,swingArm ? mix(elbow[2],-.51*stride*excursion) : elbow[2]];
      const wr = [wrist[0],wrist[1]+bob+.045*w*swing,swingArm ? mix(wrist[2],.075-.86*stride*excursion) : wrist[2]];
      const wave = pose === "waving" && side === "right" ? 16*beat : 0;
      const talk = pose === "talking" ? sign*12*beat : 0;
      articulate(sh,e,wr,value(side+"Arm")+talk,value(side+"Spread")+wave,value(side+"Elbow") + talk);
      if (torsoRotation.x || torsoRotation.y) {
        for (const point of [sh,e,wr]) {
          atWaist.fromArray(point); atWaist.y -= torso.position.y;
          atWaist.applyEuler(torsoRotation); atWaist.y += torso.position.y;
          atWaist.toArray(point);
        }
      }
      socket.position.fromArray(sh); link(arm,sh,e,.063); elbowJoint.position.fromArray(e);
      link(forearm,e,wr,.054); hand.position.fromArray(wr);
    });
  }
  let lastGait, lastPhase, lastJoints;
  group.setGait = (travel, phase, joints) => {
    if (travel === lastGait && phase === lastPhase && joints === lastJoints) return;
    lastGait = travel; lastPhase = phase; lastJoints = joints;
    const gait = travel || (step && phase != null ? {phase, weight:1, stride:pose === "running" ? 1.7 : 1.15} : null);
    const bob = gait ? -.032 * (.5+.5*Math.cos(4*Math.PI*gait.phase))*gait.weight : 0;
    const beat = Math.sin(2*Math.PI*(phase || 0));
    const value = id => (rest[id] || 0) + (joints?.[id] || 0);
    torso.position.y = waistHeight + bob;
    torsoRotation.set(radians(value("torsoLean")),radians(value("torsoTwist")),0,"YXZ");
    torso.rotation.copy(torsoRotation);
    neck.rotation.set(-radians(value("headTilt") + (pose === "nodding" ? 12*beat : 0)),
      radians(value("headTurn")),pose === "listening" ? -.17 : 0,"YXZ");
    for (const animate of animateSides) animate(gait,bob,value,beat);
  };
  group.setGait(null, undefined, undefined);
  return group;
}

export function cameraMarker() {
  const root = new T.Group();
  const body = new T.Mesh(new T.BoxGeometry(0.33, 0.23, 0.25),
    new T.MeshStandardMaterial({ color: 0x698e96, roughness: 0.58 }));
  root.add(body);
  const corners = [[-0.36,-0.20,-0.53],[0.36,-0.20,-0.53],[0.36,0.20,-0.53],[-0.36,0.20,-0.53]];
  const lines = [];
  corners.forEach((point, i) => lines.push(0, 0, -0.06, ...point, ...point, ...corners[(i + 1) % 4]));
  const geometry = new T.BufferGeometry().setAttribute("position", new T.Float32BufferAttribute(lines, 3));
  root.add(new T.LineSegments(geometry, new T.LineBasicMaterial({ color: 0x91c8ca })));
  return root;
}
