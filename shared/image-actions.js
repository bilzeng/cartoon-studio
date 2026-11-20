export const panoramaModelId = "studio:preset:panorama-qwen21";
export const legacyPanoramaModelId = "studio:preset:panorama-360";
export const panoramaLoraFile = "qwen_image_2_1_360_panorama_outpaint_lora_v0_1.safetensors";
export const panoramaSize = [2048,1024];
export const imageActionNames = { turnaround:"制作三视图", panorama:"制作全景图" };

export const isPanoramaModel = id => id === panoramaModelId || id === legacyPanoramaModelId;
export const isPanoramaNode = data => data.kind === "image" && (data.imageTask === "panorama" || isPanoramaModel(data.imageModel));

// Restore jobs can arrive newest first and an image can be restored more than once.
export function panoramaLineage(roots, originals) {
  const panoramas = new Set(roots), children = new Map();
  for (const [result, source] of originals) {
    if (!children.has(source)) children.set(source, []);
    children.get(source).push(result);
  }
  for (const id of panoramas) {
    for (const child of children.get(id) || []) panoramas.add(child);
  }
  return panoramas;
}

export function imageActionData(action,source,models) {
  const panorama = action === "panorama";
  const compatible = models.filter(m => (m.maxRefs ?? Number(!!m.reference)) >= 1 && (m.minRefs || 0) <= 1 &&
    m.hasPrompt !== false && !m.mediaSlots?.video && !m.mediaSlots?.audio &&
    !(m.dependencies || []).some(f => !f.choices.includes(f.value)));
  const general = compatible.filter(m => !m.workflow && m.canSize !== false);
  const editor = general.find(m => m.family === "qwen21") || general.find(m => m.family === "krea2") || general[0];
  const modelId = panorama ? panoramaModelId : editor?.id;
  const text = panorama
    ? "将 @图1 的环境向四周延展为 360° 等距柱状投影全景，完整覆盖水平 360° 和垂直 180°。保持原场景的空间结构、地平线、光线与风格，使画面左右边缘自然衔接。"
    : "用 @图1 中的同一主体制作三视图。从左到右依次为正面、严格 90° 侧面、180° 背面。三栏完整全身或全貌，统一比例、基线、姿态和柔光。保持五官、发型、材质、服装、配色和细节一致，使用纯色背景。";
  return {title:(source.data.title+" · "+(panorama ? "全景图" : "三视图")).slice(0,120),imageTask:action,
    canvasRef:source.id,imageRefOrder:[source.id],text,canvasRatio:"16:9",
    customSize:panorama ? {width:panoramaSize[0],height:panoramaSize[1]} : {width:1536,height:864},
    ...(modelId && {imageModel:modelId})};
}
