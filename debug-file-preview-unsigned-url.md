# debug-file-preview-unsigned-url

**Session ID**: `file-preview-unsigned-url`
**Created**: 2026-05-20
**Status**: [OPEN]
**Bug Summary**: Dify 文件预览接口返回 400 错误，提示缺少签名参数 (timestamp/nonce/sign)。请求 URL 形如 `http://172.16.12.101/files/{uuid}/file-preview`，但没有签名参数，导致 API 返回 400 BAD REQUEST。

## 1. 症状

- **实际行为**: 调用 `/files/{uuid}/file-preview` 时返回 400，错误信息为 `3 validation errors for FilePreviewQuery\ntimestamp\n  Field required\nnonce\n  Field required\nsign\n  Field required`
- **期望行为**: URL 应包含 `timestamp`、`nonce`、`sign` 三个签名参数
- **影响范围**: 模型调用时涉及文件 URL 的场景（如多模态对话、RAG 检索返回文件等）
- **复现步骤**: 上传文件后发送给模型，触发 500 错误，日志显示内部请求了无签名的 file-preview URL

## 2. 环境信息

- Dify 版本: 1.14.1
- 部署方式: Docker Compose
- 关键配置:
  - `FILES_URL=http://172.16.12.101`
  - `INTERNAL_FILES_URL=http://api:5001`
  - `SECRET_KEY=$(openssl rand -hex 32)`
  - `MULTIMODAL_SEND_FORMAT=base64` (默认)

## 3. 假设清单

### 假设 1: `UploadFile.source_url` 字段存储了无签名的 URL
- **描述**: `FileService.upload_file()` 中 `source_url` 使用 `get_signed_file_url()` 生成签名 URL，但某些旧数据或特定路径可能直接使用未签名的 `source_url`
- **验证方法**: 检查数据库中 `upload_files` 表的 `source_url` 字段，确认是否包含 `timestamp=` 字符串

### 假设 2: `re_sign_file_url_answer` 属性中的正则表达式不匹配无查询参数的裸 URL
- **描述**: `Message.re_sign_file_url_answer` 的正则 `r"\[!?.*?\]\((((http|https):\/\/.+)?\/files\/(tools\/)?[\w-]+.*?timestamp=.*&nonce=.*&sign=.*)\)"` 要求 URL 必须已包含 `timestamp=`，裸 URL 无法被重新签名
- **验证方法**: 在响应构建处添加日志，打印实际匹配到的 URL 列表

### 假设 3: RAG 检索返回的文档片段 (`Segment.get_sign_content()`) 中包含无签名的 URL
- **描述**: `Segment.get_sign_content()` 会扫描文本中的 `/files/{id}/file-preview` 并重新签名，但如果文本中的 URL 格式不匹配正则（如包含特殊字符或非 UUID 格式的 ID），则不会被重新签名
- **验证方法**: 检查 `Segment.get_sign_content()` 的正则匹配逻辑，查看日志中 LLM 返回的文本内容

### 假设 4: 某个调用路径绕过了 `resolve_file_url()` 直接构造 URL
- **描述**: 在某些代码路径（如工具调用、数据源文件等）中，可能直接拼接 `/files/{id}/file-preview` 而没有经过签名
- **验证方法**: 全局搜索 `file-preview` 字符串，找出所有构造该 URL 的代码路径

### 假设 5: LLM 模型直接返回文件 URL 作为文本响应
- **描述**: 模型收到文件后，可能在其响应文本中包含 `/files/{id}/file-preview`（不带签名），该文本被存储并后续访问时出错
- **验证方法**: 在模型响应处理处添加日志，打印完整响应文本

## 4. 插桩计划

1. 在 `core/app/workflow/file_runtime.py` 的 `resolve_upload_file_url()` 方法入口添加日志
2. 在 `services/file_service.py` 的 `upload_file()` 方法添加 `source_url` 日志
3. 在 `Message.re_sign_file_url_answer` 属性中添加 URL 列表日志
4. 在 API 端点 `controllers/files/image_preview.py` 的 `FilePreviewApi.get()` 方法添加请求参数日志

## 5. 进展记录

| 时间 | 步骤 | 状态 | 说明 |
|------|------|------|------|
| 2026-05-20 | 创建调试会话 | ✅ | 建立 debug 文件 |
| 2026-05-20 | 启动调试服务器 | ✅ | 调试服务器在 18921 端口运行 |
| 2026-05-20 | 添加日志插桩 | ✅ | 完成代码分析 |
| 2026-05-20 | 复现并收集日志 | ✅ | 确认是知识库上传文件嵌入时报错 |
| 2026-05-20 | 分析根因 | ✅ | extractors 使用绝对 URL 写入，正则不匹配 |
| 2026-05-20 | 应用修复 | ✅ | 修改 models/dataset.py 正则支持绝对 URL |
| 2026-05-20 | 重启容器验证 | ⏳ | 等待容器启动 |