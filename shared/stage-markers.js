// A selection addresses authored keys by track and time, including the camera-cut track.
export function stageTracks(stage) {
  return [
    {id:"cuts",type:"cuts",name:"机位切换",keys:stage.animation?.cuts || []},
    ...stage.objects.map(o => ({id:o.id,type:o.type,name:o.name || "未命名对象",keys:o.keys || []})),
  ];
}
export const markerId = ({track,frame}) => JSON.stringify([track,frame]);

// Validate the whole group before editing any track. A null offset deletes the group.
export function editMarkers(stage, markers, offset, end) {
  if (!markers.length || offset === 0) return stage;
  if (offset !== null && !Number.isInteger(offset)) throw Error("关键帧需落在整帧上");
  const grouped = new Map();
  for (const {track,frame} of markers) {
    if (!grouped.has(track)) grouped.set(track,new Set());
    grouped.get(track).add(frame);
  }
  const changes = new Map();
  for (const {id,keys} of stageTracks(stage)) {
    const chosen = grouped.get(id);
    if (!chosen) continue;
    const rest = keys.filter(k => !chosen.has(k.frame));
    if (keys.length-rest.length !== chosen.size) throw Error("选中的关键帧已变化，请重新选择");
    if (offset === null) { changes.set(id,rest); continue; }
    const occupied = new Set(rest.map(k => k.frame));
    const moved = keys.filter(k => chosen.has(k.frame)).map(k => {
      const frame = k.frame+offset;
      if (frame < 0 || frame > end) throw Error("关键帧不能移出时间轴");
      if (occupied.has(frame)) throw Error("目标位置已有关键帧");
      return {...k,frame};
    });
    changes.set(id,[...rest,...moved].sort((a,b) => a.frame-b.frame));
  }
  if (changes.size !== grouped.size) throw Error("所选轨道已变化，请重新选择");
  return {...stage,...(changes.has("cuts") && {animation:{...stage.animation,cuts:changes.get("cuts")}}),
    objects:stage.objects.map(o => changes.has(o.id) ? {...o,keys:changes.get(o.id)} : o)};
}
