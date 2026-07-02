# Dify 企业版维护说明

这份文档是当前仓库的企业版维护约定。后续涉及企业版 Git 组织、官方同步、换机、Docker 验证、离线发布时，以本文档、`ENTERPRISE_REPLAY_PLAN.md` 和 `docker/README.enterprise.md` 为准，不以内化记忆或聊天记录为准。

## 当前仓库定位

- 官方上游仓库：`https://github.com/langgenius/dify.git`
- 企业版 fork：`https://github.com/D-S-William-Guo/dify.git`
- 当前官方稳定发布基线：`1.15.0` tag/tree
- 当前企业候选分支：`codex/enterprise-candidate-1.15.0-20260626`
- 当前企业版本：`1.15.0-enterprise`
- 正式企业镜像：
  - `dify-api-enterprise:1.15.0-enterprise`
  - `dify-web-enterprise:1.15.0-enterprise`

`main` 可以用于观察或同步官方开发态，但不再作为企业发布底座。企业发布底座必须是官方稳定发布 tag/tree。

## 官方 1.15.0 升级要点

本轮重建已核对官方 `1.15.0` release note。企业候选必须遵守以下升级要求：

- 数据库：升级后运行 `flask db upgrade`，本地源码命令使用 `uv run --project api flask db upgrade`。
- 插件自动升级策略：数据库迁移后必须运行 `flask backfill-plugin-auto-upgrade`，将既有租户的插件自动升级配置迁移到按插件分类生效的新模型。
- Docker/env：官方新增 19 个 env、删除 2 个 env、修改 `UV_CACHE_DIR` 默认值，并修改 compose 文件；平移旧 `.env` 后必须按 `docker/.env.example` 与 `docker/envs/**/*.env.example` 补齐。
- Plugin daemon：官方 `1.15.0` 已提供 `PIP_MIRROR_AUTO_DETECT` 与 `PIP_MIRROR_URL`。企业 overlay 优先复用官方实现，只保留离线部署所需的显式传递和文档说明。
- 安全修复：官方修复 plugin-daemon forwarding path traversal（CVE-2026-41948），企业重放不得回退 plugin daemon 相关 compose/env 行为。
- 重点回归：workflow reasoning/HITL/polling、dataset spreadsheet image extraction、plugin install/OAuth/cache、dataset/RAG 与 workflow execution/session 管理相关变更都需要在点击验证中覆盖。

## PR 安全规则

企业候选分支不得向官方仓库 `langgenius/dify` 开 Pull Request。

硬规则：

- 推送企业候选分支后，不要点击 GitHub 自动提示的 upstream "Create pull request" 链接。
- 如需 PR，只允许在企业 fork `D-S-William-Guo/dify` 内部创建。
- PR 的 base repository 必须是 `D-S-William-Guo/dify`，不能是 `langgenius/dify`。
- PR 的 head branch 应来自 `D-S-William-Guo/dify` 内的企业候选或功能分支。
- 创建或更新 PR 前，agent 必须先明确核对 base repo；不确定时不得创建 PR。
- 如果误向官方仓库打开 PR，立即关闭并说明是企业 fork 工作流误开，不请求官方 review。

安全示例：

```text
base: D-S-William-Guo/dify:enterprise/main
head: D-S-William-Guo/dify:codex/enterprise-candidate-1.15.0-20260626
```

危险示例：

```text
base: langgenius/dify:main
head: D-S-William-Guo/dify:codex/enterprise-candidate-1.15.0-20260626
```

## 当前正确工作模式

企业维护方式已经从“在旧企业分支上长期 merge 官方 main”切换为“以官方稳定 tag/tree 为底座，按能力重放企业补丁”。

当前分支定位：

- `codex/enterprise-candidate-1.15.0-20260626`：当前最佳企业候选分支，基于官方 `1.15.0` tag/tree。
- `main`：官方开发态观察/同步分支，不承载企业功能，不作为发布底座。
- `enterprise/main`：只有在候选分支通过验证并晋升后，才作为干净企业长期分支。
- `codex/enterprise-candidate-20260424` 与 `D:\CodexSpace\dify-enterprise-candidate-20260424`：旧 `1.13.3` 企业候选、排障记录和补丁参考来源，不允许整树复制。

以后官方发布 `1.15.0`、`1.16.0` 等稳定版本时，固定流程是：

1. `git fetch upstream tag <official-version>`
2. 从官方稳定 tag/tree 创建新的企业候选分支。
3. 按 `ENTERPRISE_REPLAY_PLAN.md` 的能力分组重放企业补丁。
4. 每组补丁验证后提交。
5. 重建企业镜像、force recreate 对应 compose 服务、浏览器点击验证、检查日志。
6. 最终离线打包使用 `Mode=reuse` 导出同一批已经验证过的镜像。

## 企业能力边界

必须长期维护的核心企业能力：

- 企业多空间管理。
- 平台管理员。
- 智慧广场提交、审核、展示、复制导入。
- Docker enterprise overlay。
- 离线打包与最小配置包规则。
- 插件本地/离线安装相关修复。
- 知识库 hit testing / dataset 相关已验证修复。

旧候选中的 DSL、configuration hook、workflow、plugin、dataset、tool 等广覆盖补丁，必须先对比官方 `1.15.0`，确认官方没有等价修复且企业能力仍需要后，才允许最小重放。

## 固定重建流程

从官方稳定版本重建企业候选：

```powershell
git clone https://github.com/langgenius/dify.git D:\CodexSpace\dify-enterprise-1.15.0-candidate-20260626
cd D:\CodexSpace\dify-enterprise-1.15.0-candidate-20260626
git remote rename origin upstream
git remote add origin https://github.com/D-S-William-Guo/dify.git
git fetch upstream tag 1.15.0
git switch -c codex/enterprise-candidate-1.15.0-20260626 1.15.0
```

如果工作树已经存在，应先确认目录内容，不得删除未知文件。当前候选已从 `refs/tags/1.15.0` 创建。

## 本机升级工作区与运行数据继承规则

在同一台开发电脑上做新官方版本、新候选分支升级时，目标是“代码和 compose 运行面干净，业务验证数据尽量继承”。除非官方 release notes 明确存在破坏性升级、数据结构不兼容，或用户明确要求重置环境，否则不要让用户重新初始化账号、空间、工作流、插件、知识库、智慧广场等验证数据。

硬规则：

- 新版本必须使用新的工作目录、新候选分支和当前目录下的 compose 文件启动，不得复用旧工作目录里的 compose 运行面。
- 新工作区启动 compose 前，应优先从上一稳定企业工作区平移 `docker/.env`，再按官方新版 `docker/envs/**` 与 `.env.example` 补齐新增配置。平移后必须检查并更新版本型配置，尤其是 `DIFY_ENTERPRISE_VERSION`，不得保留上一版本企业 tag。
- 新工作区启动 compose 前，应优先从上一稳定企业工作区平移 `docker/volumes/**`，用于保留本机开发验证所需的数据库、上传文件、Redis、插件、向量库和 sandbox 依赖。
- 平移运行数据前，先停止相关 compose 服务；如果新目录已经误初始化过，先把新目录的临时 `docker/volumes` 和 `docker/.env` 备份到本机备份目录，再用旧稳定数据覆盖新目录。
- PostgreSQL `pgdata` 可能因权限无法由普通用户复制。可使用临时 `busybox`/`alpine` 容器以 root 身份同时挂载旧、新 `docker/volumes` 目录完成复制；复制命令不得写入旧目录。
- 启动新环境时必须显式传入 `DIFY_ENTERPRISE_VERSION=<new-version>-enterprise` 和需要的 `COMPOSE_PROFILES`。1.15.0 起默认应包含 `collaboration`，即常规本机验证使用 `COMPOSE_PROFILES=weaviate,postgresql,collaboration`，不要只依赖旧 `.env` 里的 profile 或镜像配置。启动前执行 `docker compose ... config --images`，确认 API/Web/worker/api_websocket 全部解析到当前企业版本镜像。
- 启动后必须检查所有 Dify 相关容器的 `image`、image ID、compose project 和 bind mount 路径，确认 API/Web/worker/api_websocket 使用新版本企业镜像，且 `db`、`redis`、`plugin_daemon`、`weaviate`、`sandbox`、`ssrf_proxy` 等服务全部挂载到新工作目录。
- 不允许只重建 API/Web，而让 `api_websocket`、`weaviate`、`sandbox`、`ssrf_proxy`、`plugin_daemon` 等依赖服务继续挂载旧工作目录或使用官方 API 镜像。
- 旧企业镜像可以保留为本机缓存，但运行容器不得引用旧企业版本 tag。

迁移完成后，应通过只读检查确认旧数据已经接管新环境，例如账户、空间、应用、知识库、已安装插件、智慧广场资产数量，以及 `alembic_version` 是否到达当前企业迁移 head。浏览器访问 `/apps` 应进入登录页或已登录工作台，不应进入初始化页。

知识库验证不能只看 PostgreSQL。对于 `VECTOR_STORE=weaviate` 的本机升级，必须运行：

```bash
scripts/check-enterprise-vector-indexes.sh
```

这个脚本会检查每个存在 completed/enabled 分段的高质量知识库是否有对应 Weaviate class。若报告缺失，说明业务库数据已经平移但向量库目录未正确平移、挂载到了空目录或 schema 状态丢失。此时运行：

```bash
scripts/check-enterprise-vector-indexes.sh --repair
scripts/check-enterprise-vector-indexes.sh
```

第二次只读检查通过后，才允许进入浏览器知识库召回测试。不得把“知识库列表和文档存在”视为向量召回已迁移成功。

## 官方版本与企业镜像版本

每次从官方稳定 tag/tree 创建候选后，按下面顺序确定企业版本：

1. 从 `api/pyproject.toml` 读取官方后端版本。
2. 从 `web/package.json` 读取官方前端版本。
3. 确认两者完全一致。
4. 生成 `官方版本-enterprise`。

本轮版本为：

- 官方版本：`1.15.0`
- 企业版本：`1.15.0-enterprise`
- API 镜像：`dify-api-enterprise:1.15.0-enterprise`
- Web 镜像：`dify-web-enterprise:1.15.0-enterprise`

`worker` 与 `worker_beat` 运行时继续复用 `dify-api-enterprise:1.15.0-enterprise`。

## 禁止带入内容

新候选不得从旧目录或旧分支带入：

- `docker/volumes/**`
- `docker/.build/**`
- `node_modules/**`
- `web/.next/**`
- `api/.venv/**`
- `.git/**`
- 本机缓存、日志、临时测试数据、运行态产物
- 未经重新验证的旧性能实验或大面积 UI/测试漂移

`docker/volumes/**` 里的数据库、Redis、插件、向量库和上传文件等运行数据，日常开发、镜像重建和 compose recreate 时不得擅自删除。只有用户明确要求重置环境，或明确批准删除影响后，才允许清理。

## Docker 验证硬规则

只要本轮改动涉及运行时代码，必须先重建对应 enterprise 镜像，再用这批新镜像重建 compose 服务后做点击验证。

- 后端运行时代码变更：重建 `api`，然后 force recreate `api api_websocket worker worker_beat nginx`。
- 前端运行时代码变更：重建 `web`，然后 force recreate `web nginx`。
- Nginx 配置变更：force recreate `nginx`。

本地 `pytest`、`pnpm type-check`、定向前端测试只算第一道门，不算最终运行态验证。点击验证、日志排查、最小联调如果不是基于本轮刚重建出来的容器，默认视为验证无效。

## 离线发布规则

离线发布默认使用两件套：

- 已验证镜像包：由 `scripts/build-enterprise-offline.ps1` 或 `.sh` 导出。
- 最小配置包：只包含 compose、nginx、ssrf、env 示例、同步脚本和 manifest，不包含运行态数据。

最终打包必须使用 `Mode=reuse`，导出已经点击验证过的同一批镜像。不得先用旧容器验证，再打包另一批新镜像上线。
