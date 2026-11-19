# 第三方来源与许可说明

镜场是独立的本地创作工作台。仓库包含镜场源码、工作流定义和《潮汐电台》演示内容。工作流调用的外部程序、模型权重和图库素材各自适用其来源的许可。

| 组件 | 在镜场中的用途 |
| --- | --- |
| [ComfyUI](https://github.com/Comfy-Org/ComfyUI) | 独立运行的生成服务。镜场通过其 API 提交工作流并取回结果。 |
| [FFmpeg](https://ffmpeg.org/legal.html) | 本机视频编码和媒体转换。独立安装的 FFmpeg 适用其构建版本的条款。 |
| [JGRFW/comfyui-aicg3d-PoseSwap](https://github.com/JGRFW/comfyui-aicg3d-PoseSwap) | 提供可选的远程人物、姿势和服装参考图库。镜场按固定上游版本读取索引和选中图片。 |
| [MiniMax H3](https://github.com/MiniMax-AI/MiniMax-H3) 与 [AICG3D](https://github.com/JGRFW/comfyui-AICG3D) | H3 视频工作流与两段续接预设的外部模型及节点来源。 |
| npm 依赖 | 依赖及锁定版本见 [package-lock.json](package-lock.json)，各包随安装内容提供其许可。 |

## PoseSwap 调用的外部图库

这三套图库由上游分别标明来源和许可状态。姿势图库有非商业使用限制，服装图库上游未确认可再分发的许可，人像图库原站标注 CC0 并另有避免再分发原始数据的请求。完整信息见 [上游第三方素材声明](https://github.com/JGRFW/comfyui-aicg3d-PoseSwap/blob/44bb2f81489ebce1d11af5205698a4710dd27d7a/THIRD_PARTY_NOTICES.md)。

外部图库的图片和索引由上游提供。镜场仓库中的演示截图使用内置示例。使用 PoseSwap 时也可选择自行提供且有权使用的人物、姿势和服装参考图。
