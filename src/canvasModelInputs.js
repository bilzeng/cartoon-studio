import { canvasInputs, mediaReferenceError, resolveImages, resolveVideoInputs, resolveWorkflowInputs } from "../shared/canvas";
import { isVideoUpscale } from "../shared/generation-size";
import { h3ContinuationModelId, h3VideoModelId } from "../shared/h3-video";
import { isImageRestoreModel } from "../shared/image-restore";
import { poseSwapModelId } from "../shared/pose-swap";
import { optimizationContext } from "../shared/prompt-optimizer";
import { kinds } from "../shared/studio";
import { missingFiles } from "./ModelPicker";

export function canvasModelInputs(board, node, assets, engine) {
  const { data } = node;
  const kind = data.kind;
  const inputs = canvasInputs(board, node, assets);
  const imageModel = data.imageModel
    ? engine?.imageModels?.find((m) => m.id === data.imageModel)
    : engine?.imageModels?.find((m) => !m.workflow) ||
      engine?.imageModels?.find((m) => m.id !== poseSwapModelId && !missingFiles(m).length);
  const videos = engine?.videoModels ||
    (engine?.video ? [{ ...engine.video, id: "studio:default-video" }] : []);
  const videoModel = data.videoModel
    ? videos.find((m) => m.id === data.videoModel)
    : videos.find((m) => m.id === h3VideoModelId && !missingFiles(m).length) || videos.find((m) => !m.workflow) ||
      videos.find((m) => m.baseModel && (inputs.reference || !m.needsImage)) ||
      videos.find((m) => m.id !== h3ContinuationModelId && m.hasPrompt !== false && !missingFiles(m).length);
  const audioModels = engine?.audioModels || [];
  const audioModel = data.audioModel
    ? audioModels.find((m) => m.id === data.audioModel)
    : audioModels.find((m) => !missingFiles(m).length);
  const model = kind === "image" ? imageModel : kind === "video" ? videoModel : audioModel;
  const resolved = model?.workflow
    ? resolveWorkflowInputs(inputs, node, assets, model)
    : kind === "video"
      ? resolveVideoInputs(inputs, node, assets, videoModel)
      : resolveImages(inputs, node, assets, imageModel);
  return { inputs, imageModel, audioModels, videos, model, resolved };
}

export function nodePromptOptimization(board, node, { model, resolved }) {
  const { data } = node;
  if (!model || model.hasPrompt === false || !["image", "video", "audio"].includes(data.kind) ||
    (data.kind === "image" && isImageRestoreModel(data.imageModel)) ||
    (data.kind === "video" && isVideoUpscale(data.videoModel))) return null;
  const context = optimizationContext(data, model, resolved, data.canvasRatio || board.series.ratio, { forEditor: true });
  const inputError = resolved.error || (!model.workflow && mediaReferenceError(data.text)) ||
    (!data.text.trim() && "请先填写" + kinds[data.kind] + "描述");
  return { context, inputError, basis: JSON.stringify([data.text, context, inputError]) };
}
