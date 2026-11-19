export const restoreModelId = "studio:preset:image-restore";
export const relayRestoreModelId = "studio:preset:image-restore-relayvsr";
export const relayOriginalRestoreModelId = "studio:preset:image-restore-relayvsr-original";
export const secondPassRestoreId = "studio:preset:image-restore-second-pass";
export const isImageRestoreModel = (id) =>
  [restoreModelId, relayRestoreModelId, relayOriginalRestoreModelId, secondPassRestoreId].includes(id);
export const restoreSizeKey = JSON.stringify(["size", "largest_size"]);
export const defaultRestoreSize = 3072;
export const relayRestoreSize = 2560;
export const restoreStrengthKey = JSON.stringify(["blend", "blend_factor"]);
export const defaultRestoreStrength = 0.25;
export const redrawStrengthKey = JSON.stringify(["sample", "denoise"]);
export const defaultRedrawStrength = 0.12;
export const maxRedrawStrength = 0.50;
