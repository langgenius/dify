# Docker Compose 部署

### 前置条件

| 操作系统                       | 软件                                                             | 说明                                                                                                                                                                                   |
| -------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| macOS 10.14 or later       | Docker Desktop                                                 | 将 Docker 虚拟机（VM）设置为使用至少 2 个虚拟 CPU（vCPU）和 8 GB 的初始内存。否则，安装可能会失败。有关更多信息，请参阅[在 Mac 上安装 Docker Desktop](https://docs.docker.com/desktop/mac/install/)。                                   |
| Linux platforms            | <p>Docker 19.03 or later<br>Docker Compose 1.25.1 or later</p> | 请参阅[安装 Docker](https://docs.docker.com/engine/install/) 和[安装 Docker Compose](https://docs.docker.com/compose/install/) 以获取更多信息。                                                      |
| Windows with WSL 2 enabled | <p>Docker Desktop<br></p>                                      | 我们建议将源代码和其他数据绑定到 Linux 容器中时，将其存储在 Linux 文件系统中，而不是 Windows 文件系统中。有关更多信息，请参阅[使用 WSL 2 后端在 Windows 上安装 Docker Desktop](https://docs.docker.com/desktop/windows/install/#wsl-2-backend)。 |

### Clone Dify

Clone Dify 源代码至本地

```Shell
git clone https://github.com/langgenius/dify.git
```

### Start Dify

进入 dify 源代码的 docker 目录，执行一键启动命令：

```Shell
cd dify/docker
docker compose up -d
```

> 如果您的系统安装了 Docker Compose V2 而不是 V1，请使用 `docker compose` 而不是 `docker-compose`。通过`$ docker compose version`检查这是否为情况。在[这里](https://docs.docker.com/compose/#compose-v2-and-the-new-docker-compose-command)阅读更多信息。

部署结果：

```Shell
[+] Running 7/7
 ✔ Container docker-web-1       Started                                                                                                                                                                                       1.0s 
 ✔ Container docker-redis-1     Started                                                                                                                                                                                       1.1s 
 ✔ Container docker-weaviate-1  Started                                                                                                                                                                                       0.9s 
 ✔ Container docker-db-1        Started                                                                                                                                                                                       0.0s 
 ✔ Container docker-worker-1    Started                                                                                                                                                                                       0.7s 
 ✔ Container docker-api-1       Started                                                                                                                                                                                       0.8s 
 ✔ Container docker-nginx-1     Started
```

最后检查是否所有容器都正常运行：

```Shell
docker compose ps
```

包括 3 个业务服务 `api / worker / web`，以及 4 个基础组件 `weaviate / db / redis / nginx`。

```Shell
NAME                IMAGE                              COMMAND                  SERVICE             CREATED             STATUS              PORTS
docker-api-1        langgenius/dify-api:0.3.2          "/entrypoint.sh"         api                 4 seconds ago       Up 2 seconds        80/tcp, 5001/tcp
docker-db-1         postgres:15-alpine                 "docker-entrypoint.s…"   db                  4 seconds ago       Up 2 seconds        0.0.0.0:5432->5432/tcp
docker-nginx-1      nginx:latest                       "/docker-entrypoint.…"   nginx               4 seconds ago       Up 2 seconds        0.0.0.0:80->80/tcp
docker-redis-1      redis:6-alpine                     "docker-entrypoint.s…"   redis               4 seconds ago       Up 3 seconds        6379/tcp
docker-weaviate-1   semitechnologies/weaviate:1.18.4   "/bin/weaviate --hos…"   weaviate            4 seconds ago       Up 3 seconds        
docker-web-1        langgenius/dify-web:0.3.2          "/entrypoint.sh"         web                 4 seconds ago       Up 3 seconds        80/tcp, 3000/tcp
docker-worker-1     langgenius/dify-api:0.3.2          "/entrypoint.sh"         worker              4 seconds ago       Up 2 seconds        80/tcp, 5001/tcp
```
