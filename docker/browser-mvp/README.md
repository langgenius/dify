# Browser MVP：从干净分支启动与演示

这是单用户、本地演示用的可选部署，不是生产功能或默认 Dify 安装。
只新增 `docker/browser-mvp/` 和一个可选环境变量示例，不改 Agent/API 核心代码。
下面提供网页操作、截图和 noVNC 人工接管；本机 Chrome 是另一个可选模式。

## 1. 前提和源码

- 使用全新的独立 checkout；不要在已有 Dify 部署上执行 prepare。
- Docker（Linux containers）和 Compose >= 2.35、Python 3、uv。
- 启动网页还需要 Node/pnpm，版本按本分支根目录 `package.json` 的 engines/packageManager 安装。
- 自备 OpenAI API Key 和可访问的、支持工具与视觉的模型 ID。脚本会安装固定版本的 OpenAI 插件；不保证任意模型兼容 reasoning_effort 等配置。
- 可访问镜像源、依赖源、Dify Marketplace 和模型 API。模型调用会产生费用。
- 当前验证环境为 macOS + Docker Desktop；没有在另一台干净机器完成重装验收。

```sh
git clone --branch codex/browser-mvp-reproducible --single-branch https://github.com/langgenius/dify.git dify-browser-mvp
cd dify-browser-mvp
uv sync --project api --frozen
```

本分支基于已测试的 `e316d5b5a85c75c3d88712932262f5acb7779b57`。prepare 记录你实际 checkout 的提交，build 会校验它；准备后不要切换提交或拉取更新。升级请使用新的部署目录。

## 2. 启动后端和 noVNC 浏览器

先在仓库外创建一个只含 API Key 的私有文本文件，例如 `$HOME/.config/dify-browser-mvp/openai-key`，限制文件权限为 600。不要把 Key 写进命令行、源码或提示词。

```sh
python3 docker/browser-mvp/mvp.py prepare
python3 docker/browser-mvp/mvp.py build --variant novnc
python3 docker/browser-mvp/mvp.py up --variant novnc
python3 docker/browser-mvp/mvp.py status
python3 docker/browser-mvp/mvp.py provision --model YOUR_OPENAI_MODEL --key-file "$HOME/.config/dify-browser-mvp/openai-key"
```

把 `YOUR_OPENAI_MODEL` 替换为你的模型 ID。首次源码镜像构建耗时较长；等待 API、browser、sandbox 健康后再 provision。若 API 刚启动未就绪，等待后重试。provision 使用 Console API 做初始化/配置/发布；业务测试使用已发布 Agent 或 Service API。

默认端口：API 15011、noVNC 16090、模拟工单 16091。prepare 支持更改这些端口；若更改，还须同步下面网页环境变量、provision 的 `--api`、accept 的 `--url` 和浏览器访问地址。prepare 不会覆盖已有 `docker/.env`。

## 3. 启动 Dify 网页，进入自己的 App

在同一个 checkout 的另一个终端执行，保持前台进程运行：

```sh
pnpm install --frozen-lockfile
CONSOLE_API_URL=http://localhost:15011 \
NEXT_PUBLIC_API_PREFIX=http://localhost:15011/console/api \
NEXT_PUBLIC_PUBLIC_API_PREFIX=http://localhost:15011/api \
NEXT_PUBLIC_SOCKET_URL=ws://localhost:15011 \
NEXT_PUBLIC_DEPLOY_ENV=DEVELOPMENT \
NEXT_TELEMETRY_DISABLED=1 \
pnpm -C web dev:next --hostname 127.0.0.1 --port 13000
```

这是同源 Next 开发服务器，不是 Web 生产部署。打开 http://localhost:13000，用 `docker/browser-mvp/state/admin.json` 里的 email/password 登录。

进入 **Agents → Browser MVP Service API → Access Point → Web App → Open**。若 Web App 尚未开启，先在 Access Point 启用。每次新部署的 Agent ID、Web App 链接和密钥都不同，使用你本次生成的入口。社区版 Preview 保持原版限制，本 Demo 使用已发布 Web App。

noVNC：http://localhost:16090/vnc.html?autoconnect=true&resize=scale ，密码见 `docker/browser-mvp/state/vnc-password.txt`。它和 Dify 对话是两个页面，但对应同一个受控浏览器。

## 4. 两个现场 Demo

只运行一个活跃 Agent 会话。两段可以顺序演示，无需更换部署。

**A. 仅在对话里展示截图**：打开已发布 App，新建对话，发送：

```text
请用浏览器工具新建标签页打开 https://en.wikipedia.org，通过搜索框搜索 Aviation 并进入词条。
读取真实标题和 URL，概括开头两点内容。实际截图、核对并上传，在回答中展示图片和下载链接。
不要只返回本地文件路径。不要登录、编辑或捐款。完成后停止并保留标签页。
```

预期：对话返回实际页面内容和可打开的截图。此时不用展示 noVNC；底层仍是托管浏览器，不应把它介绍成已切换 headless。

**B. 人工接管**：等 Agent 本轮结束，打开 noVNC，在同一 Wikipedia 标签页亲自搜索 `Airbus A380` 并进入词条。不要把词条名发给 Agent。回到同一 Dify 对话发送：

```text
我已在刚才的 Wikipedia 标签页亲自操作完。先不要导航、刷新或点击。
读取当前真实标题和 URL，说明与上一轮的变化，概括当前词条开头两点内容。
重新截图、核对并上传，在回答中展示图片和下载链接。不要根据历史对话猜测页面。
```

预期：Agent 读出未被告知的新词条，截图与 noVNC 一致。接管目前靠每轮结束后人工操作，没有后端控制锁。

更多真实网页操作见 [REAL-WEB-TEST.md](REAL-WEB-TEST.md)。附件预填、人工验证码和 Submit 的完整案例见下面英文操作段落及 [VALIDATION.md](VALIDATION.md)。测试验证码每次 prepare 随机生成，在私有 `docker/.env` 的 `DEMO_VERIFICATION_CODE`，不要把它发给 Agent。托管浏览器的模拟站点地址为 `http://fixture:16081`。

## 5. 凭证与发布边界

以下文件在运行时生成，**不能提交或打包**：

| 位置 | 内容 |
| --- | --- |
| `docker/.env` | 服务密码、认证密钥、模拟验证码 |
| `docker/browser-mvp/state/admin.json` | Dify 管理登录资料 |
| `docker/browser-mvp/state/agent.json` | Agent ID 与 Service API Key |
| `docker/browser-mvp/state/vnc-password*` | noVNC 密码 |
| `docker/browser-mvp/state/host-token`、`chrome-profile/` | 本机桥接令牌、浏览器数据 |
| `docker/browser-mvp/state/` 的其他文件 | SSE、截图、结果和会话数据 |
| 仓库外的模型 Key 文件 | 模型供应商凭证 |

整个 state 目录由本目录 `.gitignore` 排除，`docker/.env` 由仓库规则排除。源码中的 example.com、测试 token 和虚构工单不是生产凭证。镜像与依赖版本哈希不是密钥。

当前没有多用户隔离、生产设备接入、强制人工 Submit 权限或自动接管恢复；不要开放到公网或用于客户生产数据。截图文件上传沿用 Dify 原有能力，没有新增前端渲染。

## 6. 停止、重启与排障

- 网页进程所在终端按 Ctrl+C。
- 停止容器：`python3 docker/browser-mvp/mvp.py down --variant novnc`。数据卷保留，不执行全局 prune。
- 重启相同部署：`python3 docker/browser-mvp/mvp.py up --variant novnc`，然后重跑第 3 节网页命令；不要重新 prepare。
- 本机 Chrome 模式另有宿主进程，PID 记录在 `state/local-processes.json`；确认对应进程后单独停止，不要批量结束其他 Chrome。
- 网页网络错误：检查 API 15011 健康以及第 3 节四个地址是否一致，不要连接另一个本地 Dify 实例。
- noVNC 不可访问：确认使用 novnc 模式，browser 健康；headless/local-chrome 模式不提供该端口。
- 只有截图路径没有图片：要求 Agent 执行文件上传，并返回 Markdown 图片和下载链接；`read_media` 仅让模型看到图片。
- 模型拒绝或无法执行：确认供应商余额、模型可用性、工具/视觉支持及模型设置。当前脚本只配置 OpenAI。
- 切换模式会替换 browser 服务；完成当前任务后再切换，不能同时演示多个独立会话。

---

## Technical reference — reproducible, single-user Service API acceptance

This optional overlay reuses the repository's `docker/docker-compose.yaml` services.
It adds a CLI to `local_sandbox`, a browser service, and a fictional acceptance website.
It does not change the Agent tool loop, expose a test chat panel, or disable Community
edition checks. Console API is used only for setup/publication; all acceptance runs
use a published Agent's `/v1/chat-messages` and application API key.

Tested source: `e316d5b5a85c75c3d88712932262f5acb7779b57`.
Chrome DevTools CLI: `1.13.0`; upstream skill provenance is in `THIRD_PARTY.md`.

## Prerequisites and boundary

- Dedicated checkout, Docker Compose >= 2.35, Docker with Linux containers, Python 3, uv.
- For the host Chrome variant: Node is not needed on the host; Python aiohttp and a
  separately launched Chrome are used. Current host verification is macOS + Docker Desktop.
- A model supporting tools and vision, plus its provider credential in a local private file.
- One operator, one active conversation/browser. This is not a multi-tenant browser service.
- `api`, `agent_backend`, Postgres, Redis, plugin daemon, sandbox and SSRF proxies use
  the existing Compose definitions. This API-first minimum does not start Web, Celery,
  vector databases, or unrelated optional services. Do not claim those paths were tested.
- API/Agent images are built with their official Dockerfiles, not an older release image.
- Never run prepare against an existing deployment. It refuses to overwrite `docker/.env`.

## Fresh deployment

Run from the dedicated repository root. Place this `docker/browser-mvp` directory
in a checkout at the tested SHA, then:

```sh
uv sync --project api --frozen
python3 docker/browser-mvp/mvp.py prepare
python3 docker/browser-mvp/mvp.py build --variant novnc
python3 docker/browser-mvp/mvp.py up --variant novnc
python3 docker/browser-mvp/mvp.py status
python3 docker/browser-mvp/mvp.py provision --model YOUR_OPENAI_MODEL --key-file /absolute/private/model-key-file
```

`prepare` generates fresh secrets and test code; no credential is included in source.
Optional deployment settings are documented in `docker/envs/core-services/browser-mvp.env.example`.
Ports and project name can be changed through `prepare --api-port ... --novnc-port ...
--fixture-port ... --host-cdp-port ... --project ...`. If changing ports, pass matching
`--api`, `--url` or bridge options to the commands below. Defaults are documented, not
per-machine IPs or fixed conversation IDs. Endpoint configuration is in private
`state/browser.json`; Compose DNS supplies the container address.

Provisioning installs a pinned official OpenAI plugin, configures the model (override
with `--model`), creates/publishes an Agent and enables its Service API. Management
credentials are in `state/admin.json`; the Service API credential is in `state/agent.json`.
Do not distribute `state/`, `docker/.env`, database volumes or browser profiles.

## Case: human verification → attachment prefill → human submit → read receipt

The fictional request is `fixture/维修申请-虚构资料.txt`. It is automatically uploaded
with the first Service API message. This mock code tests the handoff, not CAPTCHA
vendor compatibility, anti-bot bypass or a real enterprise SSO system.

### A. noVNC: a remotely viewable, operable browser

```sh
python3 docker/browser-mvp/mvp.py accept wait --session novnc
```

1. Agent must stop at the verification page.
2. Open <http://localhost:16090/vnc.html?autoconnect=true&resize=scale>.
   Its password is in `state/vnc-password.txt`. The mock verification code is
   `DEMO_VERIFICATION_CODE` in `docker/.env`; do not send that code to the Agent.
3. Personally enter the code and click the login button in that same remote browser.
4. Run:

```sh
python3 docker/browser-mvp/mvp.py accept prefill --session novnc
```

5. Observe fields changing; confirm the review note is empty, final checkbox unchecked
   and no ticket created. The answer must include an uploaded PNG image and download
   link. The script downloads that signed link, verifies PNG bytes and records SHA256.
6. Personally change the date to `2026-12-10`, set the review note to
   `Reviewed - pickup Tuesday`, check confirmation and click Submit. English avoids
   remote desktop IME differences. Wait for **已提交 · 服务器回执** and a `DEMO-...` ID.
7. Run:

```sh
python3 docker/browser-mvp/mvp.py accept receipt --session novnc
```

The Agent is not told the expected edits in this last prompt. Its answer must contain
an actual ticket ID and those edits; the test runner checks them separately and verifies
the delivered receipt screenshot. If you used different values, pass `--expected-date`
and `--expected-note`. An unsubmitted page is a failed acceptance, not a successful run.

### B. No noVNC: visible local Chrome, same human/Agent session

Complete and archive variant A before switching. Do not switch during a run/handoff.
The browser relay is replaced; the backend, model and Agent remain the same.

```sh
python3 docker/browser-mvp/mvp.py local-chrome
python3 docker/browser-mvp/mvp.py build --variant local-chrome
python3 docker/browser-mvp/mvp.py up --variant local-chrome
python3 docker/browser-mvp/mvp.py accept wait --session local --url http://localhost:16091
```

`local-chrome` starts a **separate Chrome profile** and an authenticated host bridge.
Use `--chrome /path/to/chrome` on a different OS/location. The raw CDP listener binds
only to loopback; the bridge requires a random bearer token, rejects browser Origins,
and forwards only CDP discovery and browser WebSocket routes to a fixed local upstream.
It listens on host port 19223 for Docker Desktop access. This is a local MVP transport,
not a production encrypted device connector. Production needs explicit device/session
authorization, a protected transport, revocation and audit.

Operate the newly opened local Chrome window itself (not another tab/profile).
Enter the mock code, then run:

```sh
python3 docker/browser-mvp/mvp.py accept prefill --session local
# Human edits date/note and personally submits in the dedicated Chrome window.
python3 docker/browser-mvp/mvp.py accept receipt --session local
```

You can directly see the local webpage changing without noVNC. Screenshots are also
uploaded to Dify and returned as in variant A. Do not use an ordinary browser window
with a separate cookie store and expect it to share this page state.

### C. Pure headless (optional; not a full human-handoff acceptance)

```sh
python3 docker/browser-mvp/mvp.py build --variant headless
python3 docker/browser-mvp/mvp.py up --variant headless
```

This version can deliver screenshots and perform autonomous operations. It does not
provide a human control channel; it cannot by itself pass the required verification-code
and final human-submit case. Headless is a mode, not a limitation of the CLI.

## Why screenshots were previously invisible

`take_screenshot` writes a file. `read_media` attaches it for the model to inspect.
Neither operation automatically delivers an image to the end user. The Agent must also
run `dify-agent file upload PATH`, then include `public_download_url` in its reply.
This MVP requests both `![description](url)` and a download link. An API client must
render Markdown to show the image inline; otherwise users can open the link. Signed
links expire, so the test runner saves the verified PNG locally as evidence.

## Evidence and limits

`state/<session>/` contains SSE, final Markdown, downloaded screenshots and verification
JSON. Retries archive earlier files under `history/`. `acceptance.json` is written only
after receipt-ID, human-edit and screenshot checks pass. Console setup is not counted
as Service API acceptance. No assistant/browser automation substitutes for human steps.

The Agent's no-submit rule and turn-based handoff are prompts, not an enforced browser
permission system. Closing the viewing tab does not cancel Agent execution. The shared
browser is explicitly single-user. Cancelling/retiring Dify Bindings does not yet retire
this deployment-managed browser. Automatic per-Binding browser allocation, cancellation
cleanup, real enterprise login compatibility and Windows SAP remain outside this MVP.

Sandbox networks retain the official Agent/SSRF boundaries. The browser receives a
separate control network; container Chrome uses the existing Agent SSRF proxy for
external browsing and bypasses it only for the isolated fixture. The noVNC variant
also has a host-access network so its loopback-published viewing port works with Docker
Desktop; Chrome proxy flags are not a container-wide egress firewall. The fixture has
its own host-access network for the local Chrome variant. The local-Chrome relay
has a separate host-access network; it does not put `local_sandbox` on the API network.

The fixture is an HTTP service with browser-session state, not a chat/test panel.
Its data is in memory. Browser recreation may lose current page state; record results
before switching modes. Persistent customer login/profile storage is not implemented.

## Stop and validation

```sh
python3 docker/browser-mvp/mvp.py down --variant novnc
uv run --project api --no-sync --with ruff==0.17.3 ruff check docker/browser-mvp
uv run --project api --no-sync python -m unittest discover -s docker/browser-mvp/gateway -p 'test_*.py'
```

`down` keeps data volumes. The local Chrome/bridge PIDs are recorded in
`state/local-processes.json`; stop those specific processes when finished. Do not run
Docker-wide prune or delete unrelated data volumes. Do not ship any `state/` files.
