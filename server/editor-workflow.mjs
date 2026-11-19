import { fail } from "./storage.mjs";

const notes = new Set(["Note", "MarkdownNote", "PrimitiveNote"]);
const primitiveTypes = new Set([
  "BOOLEAN",
  "INT",
  "FLOAT",
  "STRING",
  "COMBO",
  "COMFY_DYNAMICCOMBO_V3",
]);
const active = (n) => !notes.has(n.type) && n.mode !== 2 && n.mode !== 4;

export function editorNodes(doc) {
  if (
    !Array.isArray(doc.nodes) ||
    !Array.isArray(doc.links) ||
    !doc.nodes.length ||
    doc.nodes.length > 1000
  )
    throw fail("工作流必须包含 1 到 1000 个节点及连线");
  return doc.nodes.filter(active);
}

function readWidgets(node, def) {
  const pos = Array.isArray(node.widgets_values)
    ? [...node.widgets_values]
    : [];
  const named =
    node.widgets_values_named ||
    (!Array.isArray(node.widgets_values) && node.widgets_values) ||
    {};
  const inputs = {};
  function read(schema, prefix = "") {
    for (const [name, [type, opts = {}]] of Object.entries({
      ...schema.required,
      ...schema.optional,
    })) {
      if (!Array.isArray(type) && !primitiveTypes.has(type)) continue;
      const key = prefix + name;
      const choices = Array.isArray(type) ? type : opts.options;
      const dynamic = type === "COMFY_DYNAMICCOMBO_V3";
      const options = dynamic ? choices.map((o) => o.key) : choices;
      const value = Object.hasOwn(named, key) ? named[key] : pos[0];
      const matches =
        (options && options.includes(value)) ||
        (typeof value === "string" &&
          (type === "STRING" || (options && !dynamic))) ||
        (typeof value === "number" && (type === "INT" || type === "FLOAT")) ||
        (typeof value === "boolean" && type === "BOOLEAN");
      if (matches) {
        inputs[key] = value;
        if (!Object.keys(named).length) pos.shift();
      } else if (opts.default !== undefined || options?.length) {
        inputs[key] = opts.default ?? options[0];
      } else if (
        value !== undefined ||
        Object.hasOwn(schema.required || {}, name)
      ) {
        if (!node.inputs?.some((s) => s.name === key && s.link != null))
          throw fail(
            "无法还原 #" +
              node.id +
              " " +
              node.type +
              " 的参数 " +
              key +
              "，请导出 API 格式。",
          );
      }
      if (
        opts.control_after_generate &&
        ["fixed", "increment", "decrement", "randomize"].includes(pos[0])
      )
        pos.shift();
      if (dynamic) {
        const branch = choices.find((o) => o.key === inputs[key]);
        if (branch?.inputs) read(branch.inputs, key + ".");
      }
    }
  }
  read(def.input || {});
  return inputs;
}

export function editorGraph(doc, definitions) {
  const nodes = editorNodes(doc);
  const byId = new Map(doc.nodes.map((n) => [String(n.id), n]));
  const links = new Map(
    doc.links.map((l) =>
      Array.isArray(l)
        ? [l[0], [String(l[1]), l[2]]]
        : [l.id, [String(l.origin_id), l.origin_slot]],
    ),
  );
  const missing = [
    ...new Set(
      nodes
        .filter(
          (n) =>
            !definitions[n.type] &&
            !["Reroute", "PrimitiveNode"].includes(n.type),
        )
        .map((n) => n.type),
    ),
  ];
  if (missing.length) throw fail("当前环境缺少节点：" + missing.join("、"));
  function source(link, seen = new Set()) {
    const pair = links.get(link),
      n = pair && byId.get(pair[0]);
    if (!n || seen.has(n.id) || n.mode === 2)
      throw fail("工作流含断开的输入连线，请检查后重新导入");
    if (n.type === "PrimitiveNode") return n.widgets_values?.[0];
    if (n.mode === 4 || n.type === "Reroute") {
      seen.add(n.id);
      const slot = n.inputs?.find(
        (s) =>
          s.link != null &&
          (n.type === "Reroute" || s.type === n.outputs?.[pair[1]]?.type),
      );
      if (!slot)
        throw fail("无法还原旁路节点 #" + n.id + "，请导出 API 格式。");
      return source(slot.link, seen);
    }
    return pair;
  }
  const graph = Object.create(null);
  for (const n of nodes) {
    if (["Reroute", "PrimitiveNode"].includes(n.type)) continue;
    const inputs = readWidgets(n, definitions[n.type]);
    for (const slot of n.inputs || [])
      if (slot.link != null) inputs[slot.name] = source(slot.link);
    graph[String(n.id)] = {
      class_type: n.type,
      inputs,
      _meta: { title: n.title || n.type },
    };
  }
  return graph;
}
