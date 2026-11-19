// Existing projects use their original group name as the membership key.
// Keep that key (and its port) stable when the visible name changes.
export const groupPortId = (key) => "asset-group:" + key;

export function canvasGroups(nodes) {
  const groups = new Map();
  for (const n of nodes) {
    const key = n.data.canvasGroup;
    if (!key) continue;
    const id = groupPortId(key);
    if (!groups.has(id))
      groups.set(id, {
        id,
        key,
        name: n.data.canvasGroupName || key,
        members: [],
      });
    groups.get(id).members.push(n);
  }
  return groups;
}

export function upstreamNodes(board, target) {
  const groups = canvasGroups(board.nodes);
  const nodes = new Map(board.nodes.map((n) => [n.id, n]));
  const upstream = new Map();
  for (const edge of board.edges) {
    if (edge.target !== target) continue;
    const direct = nodes.get(edge.source);
    for (const n of direct ? [direct] : groups.get(edge.source)?.members || [])
      if (n.id !== target) upstream.set(n.id, n);
  }
  return [...upstream.values()];
}

export function validCanvasEndpoints(nodes, groups, source, target) {
  if (!nodes.has(target) || source === target) return false;
  return (
    nodes.has(source) ||
    !!groups.get(source)?.members.every((n) => n.id !== target)
  );
}

export function removeCanvasNodes(board, ids) {
  const removed = new Set(ids);
  const nodes = board.nodes.filter((n) => !removed.has(n.id));
  const remaining = new Set(nodes.map((n) => n.id));
  const groups = canvasGroups(nodes);
  return {
    ...board,
    nodes,
    edges: board.edges.filter((e) =>
      validCanvasEndpoints(remaining, groups, e.source, e.target),
    ),
    order: board.order.filter((id) => !removed.has(id)),
  };
}

// Dissolving a group leaves its downstream nodes connected to the same members.
export function regroupNodes(board, memberIds, key, name) {
  const members = new Set(memberIds);
  const groups = canvasGroups(board.nodes);
  const oldGroups = new Set(
    board.nodes
      .filter((n) => members.has(n.id) && n.data.canvasGroup)
      .map((n) => groupPortId(n.data.canvasGroup)),
  );
  const edges = [];
  const seen = new Map();
  for (const e of board.edges) {
    let sources = [e.source];
    if (oldGroups.has(e.source)) {
      sources =
        key && !members.has(e.target)
          ? [groupPortId(key)]
          : groups.get(e.source).members.map((n) => n.id);
    }
    if (!seen.has(e.target)) seen.set(e.target, new Set());
    for (const source of sources) {
      if (seen.get(e.target).has(source)) continue;
      seen.get(e.target).add(source);
      edges.push(
        source === e.source ? e : { ...e, id: crypto.randomUUID(), source },
      );
    }
  }
  if (edges.length > 1000)
    throw Error("拆开资产组会超过 1000 条连线，请先断开部分组连线");
  return {
    ...board,
    edges,
    nodes: board.nodes.map((n) => {
      if (!members.has(n.id)) return n;
      const data = { ...n.data };
      if (key) Object.assign(data, { canvasGroup: key, canvasGroupName: name });
      else {
        delete data.canvasGroup;
        delete data.canvasGroupName;
      }
      return { ...n, data };
    }),
  };
}
