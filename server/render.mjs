import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { currentShots, frameAsset } from "../shared/studio.js";
import { ratios } from "../shared/series.js";
import { assetPath, fail, storeAsset } from "./storage.mjs";
const exec = promisify(execFile);
const ffmpeg = (args) =>
  exec(
    "ffmpeg",
    ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", ...args],
    { timeout: 240000, maxBuffer: 1024 * 1024 },
  );

// RelayVSR supplies the new picture. Keep the source audio packets and timestamps
// instead of passing its decoded soundtrack through another ComfyUI encode.
export async function restoreVideoAudio(picture, sourceFile) {
  const dir = await mkdtemp(path.join(tmpdir(), "studio-original-audio-"));
  try {
    const input = path.join(dir, "picture.mp4");
    const output = path.join(dir, "master.mp4");
    await writeFile(input, picture);
    const mux = (codec) => ffmpeg([
      "-protocol_whitelist", "file,pipe", "-i", input,
      "-protocol_whitelist", "file,pipe", "-i", sourceFile,
      "-map", "0:v:0", "-map", "1:a?", "-c:v", "copy", "-c:a", codec,
      "-map_metadata", "0", "-movflags", "+faststart+use_metadata_tags", output,
    ]);
    try {
      await mux("copy");
    } catch (e) {
      if (!/codec not currently supported in container|could not find tag for codec/i.test(e.stderr || "")) throw e;
      await mux("aac");
    }
    return await readFile(output);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// H3 interprets a batch of reference frames at 24 fps, regardless of the source time base.
export async function h3VideoReference(asset) {
  const dir = await mkdtemp(path.join(tmpdir(), "studio-video-ref-"));
  const output = path.join(dir, "reference.mp4");
  try {
    await ffmpeg([
      "-protocol_whitelist", "file,pipe", "-i", assetPath(asset),
      "-map", "0:v:0", "-an", "-t", "15",
      "-vf", "fps=24,scale=w='min(1344,iw)':h='min(1344,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1",
      "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p", output,
    ]);
    return await readFile(output);
  } catch (e) {
    if (e.code === "ENOENT") throw e;
    throw fail("无法读取参考视频「" + asset.name + "」的画面，请选择可播放的视频文件");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
async function hasAudio(file) {
  try {
    await ffmpeg([
      "-protocol_whitelist",
      "file,pipe",
      "-i",
      file,
      "-map",
      "0:a:0?",
      "-vn",
      "-sn",
      "-dn",
      "-t",
      "0",
      "-f",
      "null",
      "-",
    ]);
    return true;
  } catch (error) {
    if (error.stderr?.includes("does not contain any stream")) return false;
    throw error;
  }
}
export function exportPlan(board, assets, audioId) {
  const audio = assets.find((a) => a.id === audioId);
  if (audioId && audio?.kind !== "audio") throw fail("配乐素材不可用");
  const frames = currentShots(board).map((n) => {
    const asset = frameAsset(n, board, assets);
    if (!asset) throw fail("请先给「" + n.data.title + "」选择图片或视频");
    return { asset, duration: n.data.duration };
  });
  if (!frames.length) throw fail("请先添加分镜");
  if (frames.reduce((a, b) => a + b.duration, 0) > 600)
    throw fail("单次导出最长 10 分钟");
  return {
    frames,
    audio,
    name: board.name,
    size: ratios[board.series?.ratio || "16:9"].output,
  };
}
export async function renderFilm(plan, progress, projectId) {
  const dir = await mkdtemp(path.join(tmpdir(), "cartoon-render-"));
  try {
    const entries = [];
    const size = plan.size.join(":");
    const audible = new Set();
    if (!plan.audio) {
      const videos = new Map(
        plan.frames
          .filter((f) => f.asset.kind === "video")
          .map((f) => [f.asset.id, f.asset]),
      );
      for (const asset of videos.values()) {
        if (await hasAudio(await assetPath(asset))) audible.add(asset.id);
      }
    }
    for (const [i, frame] of plan.frames.entries()) {
      await progress("渲染镜头 " + (i + 1) + " / " + plan.frames.length);
      const name = "clip-" + i + ".mp4";
      const input =
        frame.asset.kind === "image"
          ? ["-loop", "1", "-framerate", "24"]
          : ["-stream_loop", "-1"];
      await ffmpeg([
        ...input,
        "-protocol_whitelist",
        "file,pipe",
        "-i",
        await assetPath(frame.asset),
        ...(audible.size && !audible.has(frame.asset.id)
          ? ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]
          : []),
        "-t",
        String(frame.duration),
        "-map",
        "0:v:0",
        ...(audible.size
          ? [
              "-map",
              audible.has(frame.asset.id) ? "0:a:0" : "1:a:0",
              "-af",
              "apad",
              "-ar",
              "48000",
              "-ac",
              "2",
              "-c:a",
              "aac",
            ]
          : ["-an"]),
        "-vf",
        `fps=24,scale=${size}:force_original_aspect_ratio=decrease,pad=${size}:(ow-iw)/2:(oh-ih)/2,setsar=1`,
        "-c:v",
        "libx264",
        "-threads",
        "2",
        "-preset",
        "veryfast",
        "-crf",
        "21",
        "-pix_fmt",
        "yuv420p",
        path.join(dir, name),
      ]);
      entries.push("file '" + name + "'");
    }
    await writeFile(path.join(dir, "list.txt"), entries.join("\n"));
    const audio = plan.audio
      ? [
          "-stream_loop",
          "-1",
          "-protocol_whitelist",
          "file,pipe",
          "-i",
          await assetPath(plan.audio),
          "-map",
          "0:v:0",
          "-map",
          "1:a:0",
          "-c:a",
          "aac",
          "-shortest",
        ]
      : audible.size
        ? ["-map", "0:v:0", "-map", "0:a:0", "-c:a", "copy"]
        : ["-an"];
    const destination = path.join(dir, "movie.mp4");
    await ffmpeg([
      "-f",
      "concat",
      "-safe",
      "1",
      "-i",
      path.join(dir, "list.txt"),
      ...audio,
      "-c:v",
      "copy",
      "-movflags",
      "+faststart",
      destination,
    ]);
    return storeAsset(
      await readFile(destination),
      "mp4",
      "video",
      plan.name + " · 成片.mp4",
      { projectId, origin: "export" },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
