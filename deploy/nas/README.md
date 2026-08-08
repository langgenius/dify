# DiFly NAS 部署

适配与 Nextcloud 类似的 NAS 部署习惯：

- 端口：`8090`（对应原 Nextcloud 的 `8090:80`）
- 网络：`difly_netbridge`
- 数据：`./dev/difly_docker/`

## 与 Nextcloud compose 的对应关系

| Nextcloud                 | DiFly                                       |
| ------------------------- | ------------------------------------------- |
| `mariadb`                 | `db_postgres`（**必须用 PostgreSQL**）      |
| `nextcloud` 单容器        | `nginx` + `web` + `api` + `worker` 等多服务 |
| `8090:80`                 | `8090:80`（nginx 入口）                     |
| `nextcloud_netbridge`     | `difly_netbridge`                           |
| `./dev/nextcloud_docker/` | `./dev/difly_docker/`                       |

## 快速启动

```bash
cd deploy/nas
cp .env.example .env
# 编辑 .env：修改 192.168.1.100、INIT_PASSWORD、DB_PASSWORD、REDIS_PASSWORD
sh setup.sh up
```

或手动：

```bash
cd deploy/nas
cp .env.example .env
# 编辑 .env
cp .env ../../docker/.env
mkdir -p dev/difly_docker/{db,redis,weaviate,storage}
docker compose up -d
```

浏览器打开：**http://\<NAS_IP\>:8090/install**

## 常用命令

```bash
docker compose ps          # 查看状态
docker compose logs -f     # 查看日志
docker compose down        # 停止
docker compose pull && docker compose up -d   # 更新镜像
```

## 注意事项

1. **首次启动**需拉取多个镜像（约 5–10 GB），请耐心等待。
2. **内存建议 ≥ 8GB**；若只有 4GB，`.env` 中已降低 worker 数量，并关闭了协作模式。
3. DiFly **不能**使用 MariaDB/MySQL 替代 PostgreSQL（默认栈为 PostgreSQL + Weaviate + Redis）。
4. 若需默认简体中文，请使用 `cursor/zh-hans-default-locale` 分支并自行构建 `web`/`api` 镜像（见主仓库说明）。
