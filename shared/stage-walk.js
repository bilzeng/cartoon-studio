// Cache distances on the authored track so playback, scrubbing and offline export share a stride.
const walks = new WeakMap();
function walkSegments(actor, fps) {
  let previous = { ...actor, frame:0 }, run = null, cycles = 0;
  const segments = [];
  for (const next of actor.keys || []) {
    const dx = next.position[0] - previous.position[0], dz = next.position[2] - previous.position[2];
    const distance = Math.hypot(dx,dz), frames = next.frame-previous.frame;
    if (frames > 0 && distance > .001 && !["seated","kneeling","halfKneel","crouching"].includes(previous.pose)) {
      if (!run) { run = {start:previous.frame,end:next.frame}; cycles = 0; }
      run.end = next.frame;
      const scale = (previous.scale + next.scale)/2;
      const speed = distance*fps/(frames*scale);
      const stride = Math.min(1.55,Math.max(.55,.60 + .46*speed));
      const steps = distance/(stride*scale);
      segments.push({start:previous.frame,end:next.frame,cycles,steps,stride,run,
        yaw:previous.facePath ? Math.atan2(dx,dz)*180/Math.PI : null});
      cycles += steps;
    } else if (frames > 0) run = null;
    previous = next;
  }
  return segments;
}
export function gaitAt(actor,frame,fps) {
  if (!actor.keys?.length) return null;
  if (!walks.has(actor)) walks.set(actor,walkSegments(actor,fps));
  const segments = walks.get(actor);
  const index = segments.findIndex(s => frame >= s.start && frame < s.end);
  if (index < 0) return null;
  const s = segments[index], next = segments[index+1];
  let yaw = s.yaw;
  // Turn toward the next leg over the last few frames, following the shortest angle.
  if (yaw != null && next?.yaw != null && next.start === s.end) {
    const turn = Math.min(4,(s.end-s.start)/2);
    const t = Math.max(0,1-(s.end-frame)/turn);
    yaw += (((next.yaw-yaw+540)%360)-180)*t*t*(3-2*t);
  }
  const weight = Math.min(1,(frame-s.run.start)/3,(s.run.end-frame)/3);
  return {phase:(s.cycles+s.steps*(frame-s.start)/(s.end-s.start))%1,weight,stride:s.stride,yaw};
}
