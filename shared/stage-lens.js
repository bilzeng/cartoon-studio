export const lensPresets = [18, 24, 35, 50, 85, 135, 200];
export const defaultFocusDistance = 5;
export const minStageFov = 5;
export const maxStageFov = 100;
export const minFocalLength = 11;
export const maxFocalLength = 200;
const halfFrameHeight = 12;

export function focalLengthForFov(fov) {
  return halfFrameHeight / Math.tan(fov * Math.PI / 360);
}

export function fovForFocalLength(mm) {
  return Math.atan(halfFrameHeight / mm) * 360 / Math.PI;
}
