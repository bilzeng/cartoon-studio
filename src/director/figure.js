import * as T from "three";

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
  const seated = pose === "seated", step = pose === "walking";
  const offset = seated ? -0.43 : 0;
  shellProfile([[0,0],[0.082,0.024],[0.16,0.076],[0.177,0.13],[0.162,0.19],[0.126,0.22],[0,0.22]], 0.84 + offset, 0.78);
  oval(0, 1.13 + offset, 0, 0.14, 0.14, 0.102, joint);
  shellProfile([[0,0],[0.123,0.008],[0.153,0.069],[0.194,0.16],[0.21,0.225],[0.205,0.259],[0.158,0.291],[0.074,0.317],[0,0.32]], 1.18 + offset, 0.69);
  oval(0, 1.53 + offset, 0, 0.068, 0.088, 0.068, joint);
  const head = shellProfile([[0,0],[0.052,0.01],[0.079,0.042],[0.103,0.098],[0.111,0.169],[0.106,0.218],[0.085,0.254],[0.049,0.275],[0,0.28]], 1.551 + offset, 1.02);
  head.rotation.z = pose === "listening" ? -0.17 : 0;
  oval(0, 1.684 + offset, 0.118, 0.018, 0.026, 0.021);
  const torso = new T.Group();
  torso.add(...group.children.slice()); group.add(torso);
  const animateSides = [];
  for (const sign of [-1, 1]) {
    const hip = [0.103 * sign, 0.918 + offset, 0];
    const knee = [0.113 * sign, seated ? 0.47 : 0.5, seated ? 0.39 : step ? 0.17 * sign + 0.055 : 0.018];
    const ankle = [0.13 * sign, step && sign < 0 ? 0.17 : 0.105, seated ? 0.40 : step ? 0.31 * sign : -0.025];
    const thigh = limb(hip, knee, 0.096, 0.10);
    const kneecap = oval(...knee, 0.07, 0.071, 0.07, joint);
    const shin = limb(knee, ankle, 0.074);
    const foot = oval(ankle[0], ankle[1] - 0.047, ankle[2] + 0.069, 0.07, 0.057, 0.143);
    const shoulder = [0.204 * sign, 1.423 + offset, 0];
    let elbow = [0.255 * sign, 1.16 + offset, step ? -0.10 * sign : 0.013];
    let wrist = [0.27 * sign, 0.905 + offset, step ? -0.23 * sign + 0.07 : 0.075];
    if (seated) wrist = [0.16 * sign, 0.57, 0.29];
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
    animateSides.push((gait,bob) => {
      const t = ((gait?.phase || 0)+(sign>0 ? .5 : 0))%1, w = gait?.weight || 0;
      const swing = Math.max(0,Math.sin((t-.5)*2*Math.PI));
      const stride = gait?.stride || 1;
      // Stance moves the supporting foot back at the body's travel speed.
      const excursion = t < .5 ? .25-t : -.25+(1-Math.cos((t-.5)*2*Math.PI))*.25;
      const mix = (a,b) => a+(b-a)*w;
      const h = [hip[0],hip[1]+bob,0];
      const a = [ankle[0],mix(ankle[1],.105+.15*swing),mix(ankle[2],stride*excursion)];
      const dy = a[1]-h[1], dz = a[2]-h[2], reach = Math.hypot(dy,dz);
      const bend = Math.sqrt(Math.max(0,.445**2-(reach/2)**2));
      const k = [knee[0],mix(knee[1],(a[1]+h[1])/2+bend*dz/reach),
        mix(knee[2],(a[2]+h[2])/2-bend*dy/reach)];
      link(thigh,h,k,.096); link(shin,k,a,.074); kneecap.position.fromArray(k);
      foot.position.set(a[0],a[1]-.047,a[2]+.069);
      const sh = [shoulder[0],shoulder[1]+bob,0];
      const e = [elbow[0],elbow[1]+bob,mix(elbow[2],-.51*stride*excursion)];
      const wr = [wrist[0],wrist[1]+bob+.045*w*swing,mix(wrist[2],.075-.86*stride*excursion)];
      socket.position.fromArray(sh); link(arm,sh,e,.063); elbowJoint.position.fromArray(e);
      link(forearm,e,wr,.054); hand.position.fromArray(wr);
    });
  }
  let moving = false;
  group.setGait = gait => {
    if (!gait && !moving) return;
    moving = !!gait;
    const bob = gait ? -.032 * (.5+.5*Math.cos(4*Math.PI*gait.phase))*gait.weight : 0;
    torso.position.y = bob;
    for (const animate of animateSides) animate(gait,bob);
  };
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
