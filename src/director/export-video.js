import libraryUrl from "h264-mp4-encoder/embuild/dist/h264-mp4-encoder.web.js?url";
import { endFrameOf, sampleStage, stageFps } from "../../shared/stage-animation";
import { stageFrames } from "../../shared/director-stage";

export function videoSize(ratio) {
  const [w,h] = stageFrames[ratio];
  return [w,h].map(n => 2*Math.round(n/3));
}
export async function encodeTimeline(viewport, stage, signal, onProgress) {
  const [width,height] = videoSize(stage.ratio), count = endFrameOf(stage);
  signal.throwIfAborted();
  const worker = new Worker(new URL("./video-worker.js",import.meta.url));
  let pending, failure, render;
  const fail = error => { failure = error; pending?.reject(error); };
  const abort = () => fail(signal.reason);
  signal.addEventListener("abort",abort,{once:true});
  worker.onerror = () => fail(Error("视频编码器未能运行，请刷新页面重试"));
  worker.onmessageerror = () => fail(Error("无法读取编码结果"));
  worker.onmessage = ({data}) => {
    if (data.error) fail(Error(data.error));
    else pending?.resolve(data);
  };
  function send(message, transfer=[]) {
    if (failure) throw failure;
    return new Promise((resolve,reject) => {
      pending = {resolve,reject};
      worker.postMessage(message,transfer);
    });
  }
  try {
    await send({type:"start",library:new URL(libraryUrl,location.href).href,width,height,fps:stageFps});
    render = viewport.beginVideo(width,height);
    // An end marker denotes the right boundary. N timeline intervals produce N video frames.
    for (let i=0;i<count;i++) {
      signal.throwIfAborted();
      const buffer = render.pixels(sampleStage(stage,i)).buffer;
      await send({type:"frame",buffer},[buffer]);
      onProgress(i+1,count);
    }
    const {bytes} = await send({type:"finish"});
    return new Blob([bytes],{type:"video/mp4"});
  } finally {
    worker.terminate(); signal.removeEventListener("abort",abort); render?.restore();
  }
}
