export const restoreModelId = "studio:preset:image-restore";
export const relayRestoreModelId = "studio:preset:image-restore-relayvsr";
export const relayOriginalRestoreModelId = "studio:preset:image-restore-relayvsr-original";
export const isImageRestoreModel = (id) =>
  id === restoreModelId || id === relayRestoreModelId || id === relayOriginalRestoreModelId;
export const restoreSizeKey = JSON.stringify(["size", "largest_size"]);
export const defaultRestoreSize = 3072;
export const relayRestoreSize = 2560;
export const restoreStrengthKey = JSON.stringify(["blend", "blend_factor"]);
export const defaultRestoreStrength = 0.25;
