// Dimensions are width, height and depth in metres. Each model is anchored to the floor.
export const propCatalog = {
  table:    { name:"木桌", group:"家具", size:[1.6,.76,.85], color:"#ad8966" },
  chair:    { name:"靠背椅", group:"家具", size:[.5,.92,.53], color:"#bf9a74" },
  sofa:     { name:"双人沙发", group:"家具", size:[1.95,.86,.9], color:"#78968c" },
  bookcase: { name:"书架", group:"家具", size:[1.3,1.95,.36], color:"#9c7d63" },
  wall:     { name:"墙板", group:"建筑", size:[3,2.8,.16], color:"#b9aca0" },
  doorway:  { name:"门框", group:"建筑", size:[1.15,2.18,.2], color:"#a37d5e" },
  window:   { name:"窗框", group:"建筑", size:[1.55,1.35,.14], color:"#91a4a2" },
  stairs:   { name:"台阶", group:"建筑", size:[1.7,1.05,1.85], color:"#a7a49e" },
  tree:     { name:"阔叶树", group:"室外", size:[2.4,3.8,2.3], color:"#748d64" },
  bench:    { name:"长椅", group:"室外", size:[1.75,.84,.62], color:"#a58a69" },
  lamp:     { name:"路灯", group:"室外", size:[.58,3.3,.5], color:"#728088" },
  box:      { name:"方体", group:"基础几何", size:[1,1,1], color:"#a59e91" },
  cylinder: { name:"圆柱", group:"基础几何", size:[1,1,1], color:"#91a3a6" },
  sphere:   { name:"球体", group:"基础几何", size:[1,1,1], color:"#b0937a" },
};
export const weaponCatalog = {
  straightSword: { name: "古风长剑", size: [.24, 1.06, .10], color: "#b7d1df" },
  curvedBlade: { name: "弧刃长刀", size: [.32, 1.12, .11], color: "#d4b580" },
  stageStaff: { name: "长棍", size: [.07, 1.65, .07], color: "#bd8b62" },
  stageSpear: { name: "长枪", size: [.26, 1.85, .12], color: "#abb9c1" },
  stageHalberd: { name: "月牙戟", size: [.42, 1.9, .13], color: "#9bbac5" },
  moonShield: { name: "圆盾", size: [.61, .61, .14], color: "#c39a68" },
  propDagger: { name: "短刃", size: [.14, .38, .06], color: "#acccd1" },
  fantasyHammer: { name: "奇幻战锤", size: [.38, .88, .19], color: "#8899bd" },
};
for (const [id, weapon] of Object.entries(weaponCatalog)) {
  propCatalog[id] = { ...weapon, group: "兵器道具" };
}
export const stageShapes = Object.fromEntries(Object.entries(propCatalog).map(([id,p]) => [id,p.name]));
