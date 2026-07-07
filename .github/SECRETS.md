# GitHub Secrets for Company Dify CI/CD

把密钥配置在 GitHub `Settings -> Environments`，不要写入仓库。建议至少创建两个 Environment：`staging` 和 `production`。

## Environment Secrets

| Secret | Environment | 用途 |
| --- | --- | --- |
| `DEPLOY_HOST` | staging / production | 部署目标服务器域名或 IP |
| `DEPLOY_USER` | staging / production | SSH 部署用户，建议专用低权限账号 |
| `DEPLOY_SSH_KEY` | staging / production | 部署用户私钥，只允许访问部署目录 |
| `DEPLOY_PATH` | staging / production | 服务器上 Dify `docker/` 目录或含 `docker-compose.yaml` 的目录 |
| `HEALTHCHECK_URL` | staging / production | 发布后健康检查地址 |

## Built-in token

`company-release-ghcr.yml` 使用 GitHub 自动注入的 `GITHUB_TOKEN` 推送 GHCR 镜像，不需要额外配置。若 GHCR package 设为 private，服务器拉取镜像时需要在服务器上提前执行：

```bash
docker login ghcr.io
```

## Production protection

`production` environment 必须启用：

- Required reviewers：至少 1 名正式员工/技术负责人。
- Deployment branches/tags：只允许 `main`、`release/**` 或 `v*` / `company-v*` tag。
- 禁止给实习生 production secret 管理权限。
