# Dify 开发部署配置总结

## 一、项目信息

- **项目**: Dify（开源 LLM 应用开发平台）
- **部署路径**: `/home/project/dify`
- **访问地址**: http://172.16.12.101
- **Docker Compose**: v5.1.2

---

## 二、部署架构

### 2.1 方案：官方镜像 + 本地代码挂载 + 前端热重载（开发模式）

使用 `docker-compose.yaml`（官方镜像）叠加 `docker-compose.dev.yaml`（本地代码卷挂载）：

- **基础服务**（PostgreSQL、Redis、Sandbox 等）：使用官方镜像运行
- **API / Worker / WebSocket 服务**：官方镜像 + **本地源码目录覆盖**，修改代码后只需重启容器，无需重新构建镜像
- **前端**：开发模式（`Dockerfile.dev` + `next dev`），挂载本地 `web/` 目录，**保存代码即热更新**，无需重启容器

### 2.2 容器清单

| 容器 | 职责 | 依赖 |
|------|------|------|
| `docker-api-1` | API 服务（Flask/Gunicorn） | db, redis |
| `docker-worker-1` | Celery 异步任务执行器 | db, redis |
| `docker-worker_beat-1` | Celery 定时任务调度器 | db, redis |
| `docker-api_websocket-1` | WebSocket 服务（协作模式） | db, redis |
| `docker-web-1` | Next.js 前端 | api |
| `docker-nginx-1` | 反向代理 | web, api, api_websocket |
| `docker-db_postgres-1` | PostgreSQL 数据库 | - |
| `docker-redis-1` | Redis 缓存/消息队列 | - |
| `docker-sandbox-1` | 代码执行沙箱 | - |
| `docker-plugin_daemon-1` | 插件守护进程 | db, redis |
| `docker-weaviate-1` | 向量数据库 | - |
| `docker-ssrf_proxy-1` | SSRF 代理 | - |

---

## 三、配置文件

| 文件 | 说明 |
|------|------|
| `docker/docker-compose.yaml` | **主配置**，定义所有服务和共享配置 |
| `docker/docker-compose.dev.yaml` | **开发叠加配置**，挂载本地代码 |
| `docker/.env` | **主环境变量**，覆盖所有子配置 |
| `docker/envs/core-services/api.env` | API 服务配置（可选） |
| `docker/envs/core-services/worker.env` | Worker 服务配置（可选） |

### 3.1 本地代码卷挂载（docker-compose.dev.yaml）

API 相关服务的源码通过卷挂载方式覆盖容器内文件：

```yaml
services:
  api:
    volumes:
      # API 所有源代码目录（只读）
      - ../api/app:/app/api/app:ro
      - ../api/models:/app/api/models:ro
      - ../api/services:/app/api/services:ro
      - ../api/controllers:/app/api/controllers:ro
      - ../api/libs:/app/api/libs:ro
      - ../api/core:/app/api/core:ro
      - ../api/tasks:/app/api/tasks:ro
      - ../api/configs:/app/api/configs:ro
      - ../api/migrations:/app/api/migrations:ro
      - ../api/extensions:/app/api/extensions:ro
      - ../api/providers:/app/api/providers:ro
      # 存储目录（读写）
      - ./volumes/app/storage:/app/api/storage
```

**重要**：挂载子目录（如 `../api/app:/app/api/app`）会替换掉共享配置中的全局挂载 `../api:/app/api`，从而保留镜像内的 `.venv` 虚拟环境。

### 3.3 Web 前端开发模式

```yaml
# docker-compose.dev.yaml
web:
  build:
    context: ..
    dockerfile: web/Dockerfile.dev
    target: dev
  image: dify-web:dev
  restart: always
  command: ["pnpm", "--filter", "dify-web", "dev"]
  volumes:
    - ../web:/app/web:rw
  ports:
    - "3000:3000"
  environment:
    NEXT_PUBLIC_API_PREFIX: http://172.16.12.101/console/api
    NEXT_PUBLIC_PUBLIC_API_PREFIX: http://172.16.12.101/api
    NEXT_PUBLIC_SOCKET_URL: ws://172.16.12.101
    NEXT_ALLOWED_DEV_ORIGINS: 172.16.12.101
```

前端环境变量说明（需使用 `NEXT_PUBLIC_` 前缀才能在浏览器端生效）：

| 变量 | 说明 | 默认值（本地开发） |
|------|------|-------------------|
| `NEXT_PUBLIC_API_PREFIX` | Console API 地址 | `http://localhost:5001/console/api` |
| `NEXT_PUBLIC_PUBLIC_API_PREFIX` | 公开 API 地址 | `http://localhost:5001/api` |
| `NEXT_PUBLIC_SOCKET_URL` | WebSocket 地址 | `ws://localhost:5001` |
| `NEXT_ALLOWED_DEV_ORIGINS` | Next.js 开发模式允许的跨域域名（解决 Font 403） | - |

### 3.4 nginx WebSocket 代理配置（开发模式必需）

在 `docker/nginx/conf.d/default.conf` 中添加 `/_next/webpack-hmr` 位置以支持前端热重载：

```nginx
location /_next/webpack-hmr {
  proxy_pass http://web:3000;
  include proxy.conf;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_cache_bypass $http_upgrade;
}
```

### 3.2 关键修改说明

#### docker-compose.yaml 修改

1. **YAML 锚点（anchor）添加 volumes**：`shared-api-worker-config`、`shared-worker-config`、`shared-worker-beat-config` 三个共享配置都添加了 `volumes` 字段（storage + 全局 api 目录），`api_websocket` 和 `worker_beat` 也加了自己的 `volumes`（仅 storage），确保：
   - 基础服务（api、worker）有自己的 volume 声明，可以被子目录挂载覆盖
   - WebSocket 和 beat 不丢失 `.venv`

#### 修复的 Bug

1. **`estimate_args_validate` 输入参数校验**：修复 `summary_index_setting` 为 `null` 时导致 Pydantic discriminated union 报错的问题
2. **百度飞桨插件 `get_num_tokens` 返回类型**：修复 `int` 返回改为 `List[int]`，解决 `unmarshal json failed` 报错

---

## 四、启动步骤

### 4.1 首次启动

```bash
cd /home/project/dify/docker

# 1. 配置环境变量（首次或更新后）
cp .env.example .env
# 编辑 .env，设置核心 URL、数据库密码等

# 2. 启动所有服务（使用开发模式叠加配置）
docker compose -f docker-compose.yaml -f docker-compose.dev.yaml up -d

# 3. 查看启动状态
docker compose -f docker-compose.yaml -f docker-compose.dev.yaml ps

# 4. 查看日志
docker compose -f docker-compose.yaml -f docker-compose.dev.yaml logs -f
```

### 4.2 日常启动/重启

```bash
cd /home/project/dify/docker

# 启动所有服务（如果已停止）
docker compose -f docker-compose.yaml -f docker-compose.dev.yaml up -d

# 重启所有 API 相关服务（代码修改后）
docker compose -f docker-compose.yaml -f docker-compose.dev.yaml restart api worker api_websocket worker_beat

# 重启单个服务
docker compose -f docker-compose.yaml -f docker-compose.dev.yaml restart api

# 重建特定服务（如果卷挂载有问题）
docker compose -f docker-compose.yaml -f docker-compose.dev.yaml up -d --force-recreate api_websocket
```

### 4.3 停止

```bash
cd /home/project/dify/docker

# 停止所有服务（保留数据）
docker compose -f docker-compose.yaml -f docker-compose.dev.yaml down

# 停止并清理数据卷（数据会丢失！）
docker compose -f docker-compose.yaml -f docker-compose.dev.yaml down -v
```

### 4.4 切换到生产模式（去掉本地代码挂载）

```bash
cd /home/project/dify/docker

# 停止开发模式
docker compose -f docker-compose.yaml -f docker-compose.dev.yaml down

# 以纯 Docker 镜像模式启动
docker compose up -d
```

---

## 五、代码修改后的重新加载

### 5.1 Python（API）代码修改

```bash
# 方式一：重启 API 相关服务（推荐，最快）
cd /home/project/dify/docker
docker compose -f docker-compose.yaml -f docker-compose.dev.yaml restart api worker api_websocket worker_beat

# 方式二：如需开启 Flask 调试模式（代码修改后自动重载）
# 在 .env 中设置：
DEBUG=true
FLASK_DEBUG=true
```

### 5.2 前端（Web）代码修改

```bash
# 前端使用开发模式（docker-compose.dev.yaml + next dev 热重载）
# 修改代码无需重启，保存后浏览器自动热更新
cd /home/project/dify/docker

# 首次或重建
docker compose -f docker-compose.yaml -f docker-compose.dev.yaml rm -sf web
docker compose -f docker-compose.yaml -f docker-compose.dev.yaml up -d web

# 如果仅修改了静态文件（logo、favicon 等），直接刷新浏览器即可
# 容器会在第一次访问页面时自动编译
```

### 5.3 插件代码修改

插件代码存储在 plugin_daemon 容器内，需要直接进入容器修改：

```bash
# 查找插件源码位置
docker exec docker-plugin_daemon-1 find /app/storage/cwd -name "*.py" | grep embedding

# 直接修改插件文件
docker exec docker-plugin_daemon-1 sed -i 's/old/new/' /path/to/plugin/file.py

# 重启插件守护进程使修改生效
docker restart docker-plugin_daemon-1
```

---

## 六、日志查看

```bash
cd /home/project/dify/docker

# 查看所有服务日志（实时）
docker compose -f docker-compose.yaml -f docker-compose.dev.yaml logs -f

# 查看特定服务日志
docker compose -f docker-compose.yaml -f docker-compose.dev.yaml logs -f api
docker compose -f docker-compose.yaml -f docker-compose.dev.yaml logs -f worker
docker compose -f docker-compose.yaml -f docker-compose.dev.yaml logs -f plugin_daemon

# 查看容器日志（最近 N 行）
docker logs docker-api-1 --tail=50
```

---

## 七、常用管理命令

```bash
# 查看所有容器状态
docker ps --filter "name=docker-" --format "table {{.Names}}\t{{.Status}}"

# 进入 API 容器
docker exec -it docker-api-1 /bin/bash

# 进入 plugin_daemon 容器
docker exec -it docker-plugin_daemon-1 /bin/sh

# 执行 Flask 命令（创建管理员账号）
docker compose -f docker-compose.yaml -f docker-compose.dev.yaml exec -it api flask create-tenant \
  --email admin@example.com --name "Main Workspace" --language zh-CN

# 查看容器资源占用
docker stats --no-stream --filter "name=docker-"
```

---

## 八、关键注意事项

1. **卷挂载顺序**：`docker-compose.dev.yaml` 中的子目录挂载会替换共享配置中的全局 `../api:/app/api` 挂载，从而保留镜像内的 `.venv`，否则 `flask`/`gunicorn` 命令找不到
2. **`.venv` 保护**：确保 `api_websocket` 和 `worker_beat` 服务有自己的 `volumes` 声明（哪怕只保留 storage），否则会继承共享配置的全局挂载
3. **前端热重载**：web 服务使用开发模式（`Dockerfile.dev` + `next dev`），挂载 `../web:/app/web:rw` 目录，代码修改保存后浏览器自动热更新，无需重新构建
4. **数据库持久化**：数据存储在 `./volumes/` 目录，`down` 操作不会丢失数据，`down -v` 才会
5. **插件修改**：插件代码通过 plugin_daemon 运行，修改后需要重启 plugin_daemon 容器
