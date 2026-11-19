// Associate history with the current immutable project snapshot. Reopening the same
// stage keeps its history. A reload or an externally replaced stage starts a new one.
const histories = new WeakMap();
const limit = 80;
export function stageHistory(stage) {
  return histories.get(stage) || {past:[],future:[]};
}
export function recordStage(stage,next,context,label,group) {
  if (stage === next) return next;
  const history = stageHistory(stage);
  histories.delete(stage);
  if (!group || history.past.at(-1)?.group !== group || history.future.length) history.past.push({stage,context,label,group});
  if (history.past.length > limit) history.past.shift();
  history.future.length = 0;
  histories.set(next,history);
  return next;
}
export function replayStage(stage,context,redo) {
  const history = stageHistory(stage);
  const [from,to] = redo ? [history.future,history.past] : [history.past,history.future];
  const entry = from.pop();
  if (!entry) return null;
  to.push({stage,context,label:entry.label});
  histories.delete(stage);
  histories.set(entry.stage,history);
  return entry;
}
