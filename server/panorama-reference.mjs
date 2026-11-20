import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { panoramaSize } from "../shared/image-actions.js";
import { fail } from "./storage.mjs";

const ffmpeg = promisify(execFile);

// Project the photograph as a forward-facing rectilinear view. The adapter
// learns to extend pure green in the unobserved part of a 2:1 sphere.
export async function panoramaReference(file) {
  const [width,height] = panoramaSize;
  const filters = [
    `[0:v]format=gbrap,v360=input=flat:output=e:id_fov=90:w=${width}:h=${height}:alpha_mask=1[view]`,
    `color=c=0x00ff00:s=${width}x${height},format=rgb24[green]`,
    "[green][view]overlay=format=rgb:shortest=1,format=rgb24",
  ];
  try {
    const result = await ffmpeg("ffmpeg", [
      "-nostdin","-loglevel","error","-protocol_whitelist","file,pipe","-i",file,
      "-filter_complex_threads","2","-filter_complex",filters.join(";"),"-frames:v","1",
      "-f","image2pipe","-c:v","png","pipe:1",
    ], {encoding:"buffer",maxBuffer:12*1024*1024,timeout:30000});
    return result.stdout;
  } catch (cause) {
    throw fail("无法投影这张全景参考图，请确认图片可读且本机 FFmpeg 支持 v360 滤镜。", 500);
  }
}
