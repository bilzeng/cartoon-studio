export const stageModelLimit = 24 * 1024 * 1024;
const formats = ["glb","gltf","obj"];
const decode = bytes => new TextDecoder("utf-8",{fatal:true}).decode(bytes);

export function inspectStageModel(bytes, name) {
  const format = name.split(".").at(-1).toLowerCase();
  if (!formats.includes(format)) throw Error("请选择 GLB、内嵌 glTF 或 OBJ 文件");
  if (!bytes.byteLength || bytes.byteLength > stageModelLimit) throw Error("模型文件须小于或等于 24 MB");
  if (format === "obj") {
    const source = decode(bytes);
    if (!/^\s*v\s+[-+\d.]/m.test(source) || !/^\s*(?:f|l|p)\s+\d/m.test(source))
      throw Error("OBJ 文件里没有可用的几何体");
    return {format,clips:[]};
  }
  let json = bytes;
  if (format === "glb") {
    const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    if (view.byteLength < 20 || view.getUint32(0,true) !== 0x46546c67 || view.getUint32(4,true) !== 2 ||
        view.getUint32(8,true) !== view.byteLength || view.getUint32(16,true) !== 0x4e4f534a ||
        view.getUint32(12,true) > view.byteLength - 20) throw Error("无法读取 GLB 2.0 模型");
    json = bytes.subarray(20,20+view.getUint32(12,true));
  }
  let model;
  try { model = JSON.parse(decode(json)); }
  catch { throw Error("无法读取 glTF 模型"); }
  if (model?.asset?.version !== "2.0" || !Array.isArray(model.scenes) || !model.scenes.length)
    throw Error("请选择包含场景的 glTF 2.0 模型");
  for (const entry of [...(model.buffers || []),...(model.images || [])]) {
    if (entry?.uri !== undefined && (typeof entry.uri !== "string" || !/^data:[^,]+;base64,/i.test(entry.uri)))
      throw Error("模型引用了外部文件，请将纹理和网格嵌入 glTF，或另存为 GLB");
  }
  return {format,clips:(model.animations || []).slice(0,1024).map((clip,index) =>
    typeof clip.name === "string" && clip.name.trim() ? clip.name.trim().slice(0,80) : "动画 "+(index+1))};
}
