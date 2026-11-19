# 第三方来源与许可说明

镜场源码采用 [Apache License 2.0](LICENSE)。下列项目、二进制程序、模型权重与参考素材沿用各自发布方的条款。镜场通过 ComfyUI API 提交工作流，自定义节点和权重由所连接的 ComfyUI 环境提供。

## 生成工作流与媒体处理

| 上游项目 | 对应功能 | 在镜场中的接入点 |
| --- | --- | --- |
| [ComfyUI](https://github.com/Comfy-Org/ComfyUI) | 图片、视频及音频生成服务 | [API 客户端](server/comfy.mjs) 和 [工作流预设](server/presets) |
| [AICG3D](https://github.com/JGRFW/comfyui-AICG3D) | H3 分段续接和旁白。续接预设按 `AICG3D_H3*` 节点标识查找，旁白使用 `SparkTTSRun`。 | [H3 两段续接](server/presets/h3-continuation.mjs) · [Spark-TTS 预设](server/presets/catalog.mjs) |
| [AICG3D PoseSwap](https://github.com/JGRFW/comfyui-aicg3d-PoseSwap) | 在线读取上游人物、姿势和服装参考图库。生成链路由镜场的 Qwen Image 2.1 工作流组成。 | [图库接入](server/pose-gallery.mjs) · [换姿换装预设](server/presets/pose-swap.mjs) |
| [VideoHelperSuite](https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite) | Wan 2.1 视频预设使用 `VHS_VideoCombine` 编码 H.264 MP4。 | [内置生成流程](server/recipes.mjs) |
| [RelayVSR](https://github.com/kopperx/RelayVSR) | 图片高清修复与视频 ×2 超分，通过 ComfyUI 内的 RelayVSR 节点执行。 | [超分预设](server/presets/catalog.mjs) · [ComfyUI 支持记录](https://github.com/Comfy-Org/ComfyUI/pull/17511) |
| [Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN) | 备选图片超分，使用 `RealESRGAN_x4plus.pth`。 | [图片修复预设](server/presets/catalog.mjs) |
| [FFmpeg](https://github.com/FFmpeg/FFmpeg) | 本机成片编码、音视频剪辑和格式转换。便携脚本使用 [ffmpeg-installer](https://github.com/ffmpeg-installer/ffmpeg-installer) 发布的包。 | [媒体处理](server/render.mjs) · [FFmpeg 许可说明](https://ffmpeg.org/legal.html) |

预设按节点标识判断可用性。安装或升级 ComfyUI 扩展后，可在「模型与工作流」确认实际节点和权重映射。角色卡预设也会检查工作流声明的节点，包括 `CharacterAssetCardTypography` 和 `QwenImage21Cache`。

## 模型与 LoRA 的发布来源

下表列的是镜场预设涉及的模型家族和权重来源。量化版本、目录及节点绑定以 [内置预设](server/presets) 和所连接环境的配置为准。

| 用途 | 模型来源 |
| --- | --- |
| 生图与参考图编辑 | [Krea 2](https://github.com/krea-ai/krea-2) · [Qwen Image 2.1 for ComfyUI](https://huggingface.co/Comfy-Org/Qwen-Image-2.1) · [Z-Image](https://github.com/Tongyi-MAI/Z-Image) |
| 姿势适配 | [MIUProject PoseStudio for Qwen Image 2.1](https://huggingface.co/MIUProject/VNCCS_PoseStudio_QI2.1) |
| 视频生成 | [Wan 2.1](https://github.com/Wan-Video/Wan2.1) · [MiniMax H3](https://github.com/MiniMax-AI/MiniMax-H3) · [Pika H3 Flex](https://huggingface.co/Pika-Labs/Pika-H3-Flex) |
| 高清修复与视频放大 | [RelayVSR for ComfyUI](https://huggingface.co/Comfy-Org/RelayVSR) · [Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN) |
| 文字转旁白 | [Spark-TTS](https://github.com/SparkAudio/Spark-TTS) |

## PoseSwap 图库

三套图库分别适用上游声明。姿势图库有非商业使用限制，服装图库的再分发许可尚未由上游确认，人像图库原站标注 CC0 并另有避免再分发原始数据的请求。见[上游第三方素材声明](https://github.com/JGRFW/comfyui-aicg3d-PoseSwap/blob/44bb2f81489ebce1d11af5205698a4710dd27d7a/THIRD_PARTY_NOTICES.md)。

外部图库的索引和选中图片由上游提供。使用 PoseSwap 时也可以上传自己有权使用的参考图。镜场的文档封面和界面截图使用内置示例《潮汐电台》。

## 运行环境与直接依赖

直接依赖声明见 [package.json](package.json)，精确版本和传递依赖见 [package-lock.json](package-lock.json)。许可随各依赖发布。

| 项目 | 用途 | 许可 |
| --- | --- | --- |
| [Node.js](https://github.com/nodejs/node) | 本地 JavaScript 运行时 | MIT · 含各自许可的第三方组件 |
| [React](https://github.com/facebook/react) | `react` 和 `react-dom` 界面渲染 | MIT |
| [Three.js](https://threejs.org/) | 导演台的三维场景、轨道视角与物体变换 | MIT |
| [React Flow](https://github.com/xyflow/xyflow) | `@xyflow/react` 节点画布、连线和视口 | MIT |
| [CodeMirror](https://codemirror.net/) | `autocomplete`、`commands`、`state` 和 `view` 支撑提示词编辑 | MIT |
| [Lucide](https://github.com/lucide-icons/lucide) | `lucide-react` 提供界面图标 | ISC |
| [Express](https://github.com/expressjs/express) | 本地 HTTP API 和静态文件服务 | MIT |
| [ws](https://github.com/websockets/ws) | 接收 ComfyUI 的 WebSocket 执行事件 | MIT |
| [image-size](https://codeberg.org/image-size/image-size) | 提取图片尺寸 | MIT |
| [proper-lockfile](https://github.com/moxystudio/node-proper-lockfile) | 本地文件写入协调 | MIT |
| [Vite](https://github.com/vitejs/vite) · [Vite React 插件](https://github.com/vitejs/vite-plugin-react) | 开发预览、React 编译与构建 | MIT |
| [Playwright](https://github.com/microsoft/playwright) | 浏览器交互回归测试 | Apache-2.0 |

文档徽章由 [Shields.io](https://shields.io/) 提供。

## 导演台预演视频

浏览器端通过 [h264-mp4-encoder 1.0.12](https://github.com/TrevorSundberg/h264-mp4-encoder/tree/6d177fd043157606224cef4702e134dd31f6adfa) 编码 MP4。[MIT 许可](public/licenses/h264-mp4-encoder.txt)。其 WebAssembly 包使用公共领域的 [minih264](https://github.com/lieff/minih264) 和 MPL 1.1 的 libmp4v2，组件源码可从[上游源码及子模块](https://github.com/TrevorSundberg/h264-mp4-encoder)取得。
