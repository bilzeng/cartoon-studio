// Classic worker: the encoder distribution exposes HME and contains its own WASM module.
let encoder;
self.onmessage = async ({data}) => {
  try {
    if (data.type === "start") {
      importScripts(data.library);
      encoder = await self.HME.createH264MP4Encoder();
      Object.assign(encoder,{width:data.width,height:data.height,frameRate:data.fps,kbps:3000,speed:6,groupOfPictures:data.fps});
      encoder.initialize();
    } else if (data.type === "frame") {
      encoder.addFrameRgba(new Uint8Array(data.buffer));
    } else if (data.type === "finish") {
      encoder.finalize();
      const bytes = encoder.FS.readFile(encoder.outputFilename);
      self.postMessage({bytes},[bytes.buffer]);
      return;
    }
    self.postMessage({ready:true});
  } catch (error) {
    self.postMessage({error:error?.message || "视频编码失败"});
  }
};
