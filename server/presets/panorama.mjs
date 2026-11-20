import { legacyPanoramaModelId, panoramaModelId, panoramaSize } from "../../shared/image-actions.js";
import { buildImageGraph } from "../image-workflows.mjs";

const vae = "qwen_image_2.1_vae_bf16.safetensors";
const qwen21Graph = buildImageGraph({
  family:"qwen21", maxRefs:1, model:"qwen_image_2.1_bf16.safetensors", clip:"qwen3vl_8b_fp8_scaled.safetensors",
}, {vae,loras:[]}, ...panoramaSize, 1);
qwen21Graph[10].inputs.filename_prefix = "CartoonStudio/Panorama21";
export const qwenPanoramaPreset = {
  id:panoramaModelId, name:"360° 全景扩图 · 千问 2.1", graph:qwen21Graph,
  bindings:{kind:"image", prompt:JSON.stringify(["4","prompt"]), output:"10",
    images:[JSON.stringify(["100","image"])], controls:[], outputSize:panoramaSize},
};

// Keep the original preset ID for previously saved 2509 nodes.

const node = (class_type,inputs) => ({class_type,inputs});
const link = id => [id,0];
const width=1536, height=768, half=width/2;
function swapHalves(input,prefix) {
  const crop = x => node("ImageCrop",{image:link(input),width:half,height,x,y:0});
  const paste = (destination,source,x) => node("ImageCompositeMasked",{
    destination:link(destination),source:link(source),x,y:0,resize_source:false,
  });
  return {
    [prefix+"Left"]:crop(0), [prefix+"Right"]:crop(half),
    [prefix+"Start"]:paste(input,prefix+"Right",0),
    [prefix]:paste(prefix+"Start",prefix+"Left",half),
  };
}
const encode = (image,prompt) => node("TextEncodeQwenImageEditPlus",{
  clip:link("clip"),vae:link("vae"),image1:link(image),prompt,
});
const sample = (model,positive,latent,steps,denoise) => node("KSampler",{
  model:link(model),positive:link(positive),negative:link(positive+"Negative"),latent_image:link(latent),
  seed:1,steps,cfg:2.5,sampler_name:"euler",scheduler:"simple",denoise,
});
const negative = id => node("ConditioningZeroOut",{conditioning:link(id)});
const decode = id => node("VAEDecode",{samples:link(id),vae:link("vae")});

export const panoramaPreset = {
  id:legacyPanoramaModelId, name:"360° 全景扩图 · Qwen Edit 2509",
  graph:{
    source:node("LoadImage",{image:"scene.png"}),
    small:node("ImageScaleToMaxDimension",{image:link("source"),upscale_method:"lanczos",largest_size:768}),
    padded:node("ImagePadForOutpaint",{image:link("small"),left:352,top:176,right:352,bottom:176,feathering:32}),
    model:node("UNETLoader",{unet_name:"qwen_image_edit_2509_fp8mixed.safetensors",weight_dtype:"default"}),
    clip:node("CLIPLoader",{clip_name:"qwen_2.5_vl_7b_fp8_scaled.safetensors",type:"qwen_image",device:"default"}),
    vae:node("VAELoader",{vae_name:"qwen_image_vae.safetensors"}),
    adapter:node("LoraLoaderModelOnly",{model:link("model"),lora_name:"251018_MICKMUMPITZ_QWEN-EDIT_360_03.safetensors",strength_model:.9}),
    shiftedModel:node("ModelSamplingAuraFlow",{model:link("adapter"),shift:3}),
    latent:node("EmptySD3LatentImage",{width,height,batch_size:1}),
    layout:encode("padded","Create a 360 degree equirectangular panorama from the reference scene."),
    layoutNegative:negative("layout"), render:sample("shiftedModel","layout","latent",22,1), panorama:decode("render"),
    ...swapHalves("panorama","wrapped"),
    mask:node("SolidMask",{value:0,width,height}),
    strip:node("SolidMask",{value:1,width:160,height}),
    soft:node("FeatherMask",{mask:link("strip"),left:32,top:0,right:32,bottom:0}),
    seam:node("MaskComposite",{destination:link("mask"),source:link("soft"),x:half-80,y:0,operation:"add"}),
    original:node("VAEEncode",{pixels:link("wrapped"),vae:link("vae")}),
    masked:node("SetLatentNoiseMask",{samples:link("original"),mask:link("seam")}),
    repair:encode("wrapped","Continue the texture, lines and lighting naturally across the vertical seam in the middle."),
    repairNegative:negative("repair"), fix:sample("shiftedModel","repair","masked",12,.65), decoded:decode("fix"),
    repaired:node("ImageCompositeMasked",{destination:link("wrapped"),source:link("decoded"),mask:link("seam"),x:0,y:0,resize_source:false}),
    ...swapHalves("repaired","final"),
    out:node("SaveImage",{images:link("final"),filename_prefix:"CartoonStudio/Panorama"}),
  },
  bindings:{kind:"image",prompt:JSON.stringify(["layout","prompt"]),output:"out",images:[JSON.stringify(["source","image"])],
    controls:[],outputSize:[width,height]},
};
