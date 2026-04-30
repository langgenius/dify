# Dify 企业版维护说明

这份文档是当前仓库的企业版维护约定。后续涉及企业版 Git 组织、官方同步、换机、Docker 验证、离线发布时，以本文档、`ENTERPRISE_REPLAY_PLAN.md` 和 `docker/README.enterprise.md` 为准，不以内化记忆或聊天记录为准。

## 当前仓库定位

- 官方上游仓库：`https://github.com/langgenius/dify.git`
- 企业版 fork：`https://github.com/D-S-William-Guo/dify.git`
- 当前官方稳定发布基线：`1.14.0` tag/tree
- 当前企业候选分支：`codex/enterprise-candidate-1.14.0-20260430`
- 当前企业版本：`1.14.0-enterprise`
- 正式企业镜像：
  - `dify-api-enterprise:1.14.0-enterprise`
  - `dify-web-enterprise:1.14.0-enterprise`

`main` 可以用于观察或同步官方开发态，但不再作为企业发布底座。企业发布底座必须是官方稳定发布 tag/tree。

## 当前正确工作模式

企业维护方式已经从“在旧企业分支上长期 merge 官方 main”切换为“以官方稳定 tag/tree 为底座，按能力重放企业补丁”。

当前分支定位：

- `codex/enterprise-candidate-1.14.0-20260430`：当前最佳企业候选分支，基于官方 `1.14.0` tag/tree。
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

旧候选中的 DSL、configuration hook、workflow、plugin、dataset、tool 等广覆盖补丁，必须先对比官方 `1.14.0`，确认官方没有等价修复且企业能力仍需要后，才允许最小重放。

## 固定重建流程

从官方稳定版本重建企业候选：

```powershell
git clone https://github.com/langgenius/dify.git D:\CodexSpace\dify-enterprise-1.14.0-candidate-20260430
cd D:\CodexSpace\dify-enterprise-1.14.0-candidate-20260430
git remote rename origin upstream
git remote add origin https://github.com/D-S-William-Guo/dify.git
git fetch upstream tag 1.14.0
git switch -c codex/enterprise-candidate-1.14.0-20260430 1.14.0
```

如果工作树已经存在，应先确认目录内容，不得删除未知文件。当前候选已从 `refs/tags/1.14.0` 创建。

## 官方版本与企业镜像版本

每次从官方稳定 tag/tree 创建候选后，按下面顺序确定企业版本：

1. 从 `api/pyproject.toml` 读取官方后端版本。
2. 从 `web/package.json` 读取官方前端版本。
3. 确认两者完全一致。
4. 生成 `官方版本-enterprise`。

本轮版本为：

- 官方版本：`1.14.0`
- 企业版本：`1.14.0-enterprise`
- API 镜像：`dify-api-enterprise:1.14.0-enterprise`
- Web 镜像：`dify-web-enterprise:1.14.0-enterprise`

`worker` 与 `worker_beat` 运行时继续复用 `dify-api-enterprise:1.14.0-enterprise`。

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

- 后端运行时代码变更：重建 `api`，然后 force recreate `api worker worker_beat nginx`。
- 前端运行时代码变更：重建 `web`，然后 force recreate `web nginx`。
- Nginx 配置变更：force recreate `nginx`。

本地 `pytest`、`pnpm type-check`、定向前端测试只算第一道门，不算最终运行态验证。点击验证、日志排查、最小联调如果不是基于本轮刚重建出来的容器，默认视为验证无效。

## 离线发布规则

离线发布默认使用两件套：

- 已验证镜像包：由 `scripts/build-enterprise-offline.ps1` 或 `.sh` 导出。
- 最小配置包：只包含 compose、nginx、ssrf、env 示例、同步脚本和 manifest，不包含运行态数据。

最终打包必须使用 `Mode=reuse`，导出已经点击验证过的同一批镜像。不得先用旧容器验证，再打包另一批新镜像上线。
