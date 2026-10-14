# AMDGPUCloud

**作者：Letian Kang**  
**联系邮箱：Letian.Kang@amd.com**

AMD GPU Cloud / Token Factory 的 OpenAI-compatible 原生模型供应商，在 Dify 标准界面管理，当前为集成预览版。

## 安装与配置

1. 使用自建 Dify 1.17.1，先按[主文的 API 兼容步骤](../README.md#self-hosted-api-compatibility)部署覆盖层。
2. 在“集成 → 安装 → 从本地文件”安装 `AMDGPUCloud-0.0.9.difypkg`。
3. 从 [AMD GPU Cloud Model APIs](https://developer.amd.com.cn/radeon/modelapis) 手动取得自己的 `rc-*` Key。
4. 在“模型提供方 → AMDGPUCloud”保存 Key，然后在 Chat／Agent／Workflow 选择模型。

固定入口为 `https://developer.amd.com.cn/radeon/api/v1`，不接受自定义 URL。
保存凭据会发送 `max_tokens=1` 的短验证请求并消耗少量额度；`/models` 不能单独证明 Key 有效。
建议先用于测试 Workspace；本地包或未签名包被拒绝时联系管理员，不擅自关闭生产安全校验。
Windows 操作见 [INSTALL_windows_zh_Hans.txt](INSTALL_windows_zh_Hans.txt)。
插件不安装 Dify／WSL／Docker；Windows 完整应用安装器是单独交付，不属于模型接入依赖。

兼容层所需源码在仓库 `api-compat/`。将生成器、适配器及共享 `model_catalog.py`
复制到临时输入目录，在固定 API 镜像中禁网、只读并以主机 UID／GID 运行生成器。
把四个输出文件放到实际部署的 `docker/compat/`，将 `api-compat/compose.override.yaml`
加入原 Compose 调用，保留项目名、私有配置、profiles 和既有覆盖；启用时仅重建四个 API 侧进程。
生成本身不重启服务，也不读取 Key 或应用配置；基线不符时拒绝，不能套用到其他 Dify 版本。

## 动态目录与兼容边界

Dify 1.17.1／SDK 0.10.2 未接通原生远端列表链路，本版必须配合**只读 API 覆盖层**使用，
不改前端或守护进程 ABI，复用原生 Key 表单、列表、选择器和参数接口。
`predefined-model` 仅启用统一 Key 界面，包内列表为空；单独插件不提供未修改 Dify Cloud 的动态发现。

没有模型 YAML、固定验证 ID 或兜底清单；模型、上下文、能力、参数及价格由共享解析器读取公网 `/models`。
按元数据过滤 OCR／非聊天模型，新增模型无需重打包。内存缓存最多 30 秒，按凭据摘要隔离，
API 层另按租户／Provider 隔离；刷新失败报错，不返回旧目录。缓存到期后刷新原生列表即可查看变化。
调用拒绝当前目录中不存在的模型；未知最大输出值不虚构上限，默认输出预算只是客户端设置。
单工具、JSON Object 和图片能力取决于模型；不声明并行工具、JSON Schema、Embedding 或 OCR。

## 身份与升级

保留插件 ID **`amdgpucloud/amdgpucloud`** 和完整 Provider `amdgpucloud/amdgpucloud/amdgpucloud`，
同 ID 升级保留已保存 Key；不要为刷新目录卸载已配置的供应商。
更换 publisher 是独立迁移，须检查凭据、默认模型和应用引用；目录更新不复制 Key、改写应用或卸载供应商。

## 价格、隐私与归因

Dify 展示普通输入／输出估算价格，不包含缓存折扣；实际扣费、额度与限额以 Token Factory 账号和账单为准。
请求固定带 `X-Source: dify` 汇总渠道用量，不附加用户、工作区、应用、会话或请求标识，不自动授权或回填 Key。
Prompt、历史、图片和工具数据会发送到 AMD API；插件不新增持久化存储，但服务可能保留日志。
敏感数据使用前请阅读 [PRIVACY.md](../PRIVACY.md)，不要将“不新增存储”理解成平台零留存。

## 开发与验收

- 使用 Python 3.12，在插件目录执行 `uv sync --locked --group dev`、`uv run --locked pytest`、`uv run --locked ruff check .`。
- 默认测试不调用公网；显式 Live Test 使用 `uv run python scripts/run_live_tests.py --key-file /path/to/private/rc-test-key`。
  Key 文件须本人拥有、非符号链接的普通文件且权限不宽于 `0600`；仅使用专用 `rc-*` 测试 Key。
  启动器避免 Key 进入 argv 并屏蔽敏感诊断；不使用内部订阅 Key，不将 Key 写入 CI、日志或命令参数。
- 远端调试使用由 `.env.example` 配置的本地忽略文件 `.env` 和 `uv run python -m main`。
  分发前运行官方 Marketplace 校验和 `scripts/check_package.py`。
- JSON／SSE 须完整且包含用量，不自动重放流；重定向、异常帧和缺少 `[DONE]` 均安全失败。
  HTTP 读取超时为 600 秒，长请求还需配置守护进程／插件执行期限。

既有本地验证覆盖离线目录、凭据、线协议／流处理、包安全及原生供应商列表，不等于业务推理通过。
公网 Key 的 Chat／Agent／Workflow、图片／JSON／工具续轮验收和 GPU 侧取消仍待完成。
正式发布前还需核验当前输出上限、价格、Marketplace 校验、publisher 归属和品牌批准。

## 源码、支持与许可

源码：<https://github.com/JoursBleu/dify>。反馈仅附脱敏错误和版本，不提交 API Key 或完整 Prompt；联系作者见文首。
[Dify 开源许可证](../../../LICENSE)及第三方声明继续适用。
本地 Logo 不加载远端图片；来源、校验和及商标边界见 [BRAND_ASSET_NOTICE.txt](../_assets/BRAND_ASSET_NOTICE.txt)，
可用 `scripts/prepare_brand_icon.ps1` 从固定来源复现。未签名预览包不代表 AMD／Dify 或 Marketplace 批准。