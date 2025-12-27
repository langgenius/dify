# syncmind

This folder contains SyncMind-specific automation for building and publishing Dify Docker images.

## Alibaba Cloud ACR (latest-only)

Target registry/namespace:

- Registry: `crpi-2e30x3ttfmqmx83q.cn-chengdu.personal.cr.aliyuncs.com`
- Namespace: `dify-vision`

Published images (x86 only):

- `crpi-2e30x3ttfmqmx83q.cn-chengdu.personal.cr.aliyuncs.com/dify-vision/dify-api:latest`
- `crpi-2e30x3ttfmqmx83q.cn-chengdu.personal.cr.aliyuncs.com/dify-vision/dify-web:latest`

### GitHub Actions

Workflow: `.github/workflows/syncmind-push-acr.yml`

Required GitHub secrets:

- `ALIYUN_ACR_USERNAME`
- `ALIYUN_ACR_PASSWORD`

Trigger:

- Manual only (`workflow_dispatch`).

### Local push (optional)

1) Login:

```sh
docker login crpi-2e30x3ttfmqmx83q.cn-chengdu.personal.cr.aliyuncs.com
```

2) Build & push:

```sh
./syncmind/scripts/push-acr-latest.sh
```
