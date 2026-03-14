# AceDataCloud Dify 预置工作流

登录 Dify 后可以一键导入使用的 AI 工作流模板。所有工作流都绑定了 AceDataCloud 插件，登录即可使用。

## 工作流清单

### 单功能工作流

| 工作流 | 文件 | 用到的插件 | 描述 |
|-------|------|-----------|------|
| 🎨 AI 图片生成器 | `ai-image-generator.yml` | Midjourney | 输入描述 → LLM 优化提示词 → Midjourney 生成高质量图片 |
| 🖼️ Seedream 图片生成 | `seedream-image-generator.yml` | Seedream | 输入描述 → LLM 优化 → Seedream 生成图片 |
| 🎵 AI 音乐创作 | `ai-music-creator.yml` | Suno | 输入主题 → LLM 作词 → Suno 生成完整歌曲 |
| 🎥 AI 视频生成器 (Sora) | `ai-video-sora.yml` | Sora | 输入描述 → LLM 优化视频脚本 → Sora 生成视频 |
| 💃 AI 舞蹈视频 (Seedance) | `ai-dance-video-seedance.yml` | Seedance | 输入描述 → LLM 编排 → Seedance 生成动态视频 |
| 🔍 AI 深度研究助手 | `ai-research-assistant.yml` | SERP | 输入主题 → 搜索优化 → Google 搜索 + 新闻 → LLM 生成研究报告 |

### 组合工作流（多插件协作）

| 工作流 | 文件 | 用到的插件 | 描述 |
|-------|------|-----------|------|
| 🎬 AI 分镜故事视频 | `ai-storyboard-video.yml` | Flux + Kling | 一句话 → 4个分镜 → 4张图片 → 4段视频 |
| 🚀 全能创意工坊 | `creative-full-pipeline.yml` | Midjourney + Suno | 一个概念 → 同时生成配图 + 配乐 + 文案 |
| 📢 AI 营销素材全家桶 | `ai-marketing-suite.yml` | Flux + Luma + Suno | 产品概念 → 海报 + 视频 + BGM 营销套件 |
| 📱 自媒体一键创作 | `social-media-creator.yml` | SERP + Flux + NanoBanana + Veo | 热点话题 → 搜索 → 写文 → 配图 + 缩略图 + 短视频 |
| ✏️ AI Logo 设计师 | `ai-logo-designer.yml` | Flux | 品牌名+描述 → 3种风格 Logo 方案 |

### 对比工作流

| 工作流 | 文件 | 用到的插件 | 描述 |
|-------|------|-----------|------|
| 📹 图生视频对比器 | `image-to-video-compare.yml` | Luma + Kling + Hailuo | 同一张图 → 3个引擎同时生成视频对比 |
| 🏆 四引擎图片PK | `image-engine-compare.yml` | Flux + Midjourney + Seedream + NanoBanana | 同一描述 → 4个引擎生成图片对比 |

## 使用方式

### 方式一：自动导入（登录即用）

用户通过 AceDataCloud OAuth 登录 Dify 后，工作流会自动导入到工作空间。

### 方式二：手动导入

1. 进入 Dify 控制台
2. 点击「创建应用」→「导入 DSL」
3. 复制 YAML 文件内容粘贴即可

### 方式三：URL 导入

使用 GitHub raw URL 直接导入：
```
https://raw.githubusercontent.com/AceDataCloud/Dify/main/workflows/<filename>.yml
```

## 前置条件

- AceDataCloud 账号和 API Token
- 通过 AceDataCloud OAuth 登录 Dify（自动配置所有插件凭证）
- 或手动在 Dify 中配置 AceDataCloud 插件的 Bearer Token

## 涉及的 AceDataCloud 插件

| 插件 | 功能 | 被使用的工作流数 |
|------|------|----------------|
| Midjourney | AI 图片生成 | 3 |
| Flux | AI 图片生成 | 6 |
| Seedream | AI 图片生成(中国风) | 2 |
| NanoBanana | AI 图片生成 | 2 |
| Suno | AI 音乐生成 | 3 |
| Sora | AI 视频生成 | 1 |
| Luma | AI 视频生成 | 3 |
| Kling | AI 视频生成 | 2 |
| Hailuo | AI 视频生成 | 1 |
| Seedance | AI 舞蹈视频 | 1 |
| Veo | AI 视频生成 | 1 |
| SERP | Google 搜索 | 2 |
