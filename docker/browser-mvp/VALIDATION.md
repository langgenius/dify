# 浏览器 MVP 验收记录

验收日期：2026-11-18。Dify 固定源码：`e316d5b5a85c75c3d88712932262f5acb7779b57`。

## 结论

两种浏览器模式均跑通：Agent Service API → 人工验证码 → 根据附件预填 → 人工 Submit → Agent 只读服务器回执 → 上传并返回截图。
这是单人本地 MVP 的功能验证，未接入客户生产系统。人工修改值的严格断言没有全部通过，见下表。

| 模式 | 实际回执 | 日期 / 复核备注 | 结果 |
| --- | --- | --- | --- |
| noVNC 远程可视浏览器 | DEMO-3A952D | 2026-12-10 / reviewed | 业务链和实际修改读回成功；原脚本期待另一条示例备注，严格断言失败，保留原记录并人工核对截图 |
| 无 noVNC，独立本机 Chrome | DEMO-D06B71 | 2026-12-08 / 空 | 业务链成功；实际提交没有期望的日期和备注修改，因此修改值断言失败 |

两次读取回执时，提示词均没有告诉 Agent 预期修改值。截图独立核对了上述实际值，没有为使测试通过而改写业务数据或放宽脚本断言。本机模式的结果记录为 `state/local/result.json`，没有生成严格验收通过的 `acceptance.json`。

## 已验证

- 操作均由已发布 Agent 的 `/v1/chat-messages` 执行；附件通过 `/v1/files/upload` 上传。Console API 仅用于初始化、配置、发布和创建应用密钥。
- 两种模式的预填截图都显示复核备注为空、最终确认框未勾选、尚未提交。验证码和 Submit 由用户完成。
- 截图经过截图工具 → read_media → dify-agent file upload → 回答中的图片/下载链接。客户端实际下载 PNG，验证 HTTP 200、文件签名、SHA256；不只依据模型声称成功。
- 最终网络调整后，noVNC 入口返回 HTTP 200，新的 Service API 会话再次打开工单页并停在验证码。最终网络配置未另跑第二轮完整人工提交。
- 本机站点访问故障已修复：fixture 有独立 host-access 网络；浏览器控制网络保持 internal。修复后本机版本完成业务链。
- Ruff 检查、CDP 网关两项 HTTP/WebSocket 鉴权与转发测试、两种 Compose 配置解析通过。

## 部署和改动范围

在独立 checkout 添加 `docker/browser-mvp/` 和可选 `docker/envs/core-services/browser-mvp.env.example`。原工作区 tracked 文件未修改，未修改 Agent/API 核心执行循环。
使用现有 Dify Compose 服务和官方 API、Agent、sandbox Dockerfile；仅扩展 sandbox 安装 Chrome DevTools CLI/skill，并添加浏览器或转发服务、虚构业务站点。
当前是 API-first 最小部署：10 个运行服务，另有已退出的初始化容器。初始 API 验收未启动 Web、Celery、向量库。后续启动同源 Next 开发服务器，用户确认原生已发布 Web App 自测成功；这不等于生产 Web 构建验收。
旧 PoC 的 8 个容器、临时聊天面板、旧宿主 API/Agent/Web 进程已清理；保留旧数据卷，未执行全局 prune。

local-chrome 模式的工单页面为 http://localhost:16091，API 默认 http://localhost:15011；实际模式由启动命令决定。切换模式不会同时保留两个 Agent 浏览器后端；请在一个业务流程结束后切换。noVNC 端口仅在 novnc 模式运行时开放。

## MVP 边界

- 不提交规则是提示词约束，尚无后端强制拦截 Submit；不是生产级操作授权系统。
- 单人、单活跃浏览器；没有按用户/Binding 自动分配浏览器、取消时清理浏览器、多租户隔离等生命周期能力。
- 本机 Chrome 方案可行，但生产还需要设备接入、受保护传输、会话授权、撤销和审计。本次 bridge 使用随机 bearer token，原始 CDP 仅监听 loopback。
- 容器 Chrome 配置现有 SSRF 代理；noVNC host-access 网络不等于容器级出口防火墙。
- 验证码为模拟人工交接，不代表真实 CAPTCHA、SSO 或客户内网兼容性。
- 浏览器重建可能丢失页面/登录状态；截图已另行保存。
- 源码打包排除 state、凭证、数据库和 Chrome profile。按 README 在固定源码上可重新部署；未在另一台全新机器独立重装验收。

## 四段可复制提示词

先在同一 Agent 会话上传 `fixture/维修申请-虚构资料.txt`。本机模式使用 `http://localhost:16091`；noVNC 模式将 URL 换为 `http://fixture:16081`。

### 1. 打开页面，等待人工验证码

```text
连接浏览器，找到或打开 http://localhost:16091 维修工单页面。读取我上传的附件备用。遇到人工验证码就停止本轮并等待，不识别、猜测、填写或绕过验证码，不提交工单。
```

操作者在同一浏览器亲自输入验证码并登录。

### 2. 根据附件预填并返回截图

```text
我已在同一浏览器完成验证码。先确认已进入表单，再按附件填写。复核备注留空，不勾选最终确认，不点击 Submit。截图并使用 read_media 核对，再用 dify-agent file upload 上传截图；回复包含截图的 Markdown 图片和下载链接。完成后结束本轮，等待人工复核和提交。
```

### 3. 提交前只读检查（可选）

```text
只读检查当前工单，不修改任何字段、不勾选确认、不提交。报告当前字段、复核备注、最终确认框状态，以及页面是否已经生成服务器回执。截图、核对并上传，在回复中返回图片和下载链接。
```

操作者亲自修改日期和备注，勾选确认并 Submit，等待出现 DEMO- 工单号。若要跑 README 的严格断言，修改值需与命令的 expected-date / expected-note 一致。

### 4. 只读回执

```text
我已亲自 Submit。请从页面独立读取真实服务器回执，报告工单号和全部最终字段，与附件比较，指出实际差异；不要假设修改内容，不重新提交。截图并使用 read_media 核对，再上传截图，回复包含图片和下载链接。
```

## 登录资料位置

此业务站点仅使用测试验证码，没有业务账号密码。验证码为私有 `docker/.env` 中的 `DEMO_VERIFICATION_CODE`。
noVNC 密码在 `docker/browser-mvp/state/vnc-password.txt`；Dify 管理账号配置在 `state/admin.json`；应用 Service API 密钥在 `state/agent.json`。不要把这些文件打包分发或粘贴进 Agent 提示词。
