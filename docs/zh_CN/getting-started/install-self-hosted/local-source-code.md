# 本地源码启动

### 前置条件

| 操作系统                       | 软件                                                             | 说明                                                                                                                                                                                   |
| -------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| macOS 10.14 or later       | Docker Desktop                                                 | 将 Docker 虚拟机（VM）设置为使用至少 2 个虚拟 CPU（vCPU）和 8 GB 的初始内存。否则，安装可能会失败。有关更多信息，请参阅[在 Mac 上安装 Docker Desktop](https://docs.docker.com/desktop/mac/install/)。                                   |
| Linux platforms            | <p>Docker 19.03 or later<br>Docker Compose 1.25.1 or later</p> | 请参阅[安装 Docker](https://docs.docker.com/engine/install/) 和[安装 Docker Compose](https://docs.docker.com/compose/install/) 以获取更多信息。                                                      |
| Windows with WSL 2 enabled | Docker Desktop                                                 | 我们建议将源代码和其他数据绑定到 Linux 容器中时，将其存储在 Linux 文件系统中，而不是 Windows 文件系统中。有关更多信息，请参阅[使用 WSL 2 后端在 Windows 上安装 Docker Desktop](https://docs.docker.com/desktop/windows/install/#wsl-2-backend)。 |

Clone Dify 代码：

```Bash
git clone https://github.com/langgenius/dify.git
```

在启用业务服务之前，我们需要先部署 PostgresSQL / Redis / Weaviate（如果本地没有的话），可以通过以下命令启动：

```Bash
cd docker
docker compose -f docker-compose.middleware.yaml up -d
```

***

### 服务端部署

* API 接口服务
* Worker 异步队列消费服务

#### 安装基础环境

服务端启动需要使用到 Python 3.10.x，推荐使用 [Anaconda](https://docs.anaconda.com/free/anaconda/install/) 来快速安装 Python 环境，内部已包含 pip 包管理工具。

```Bash
# 创建名为 dify 的 Python 3.10 环境
conda create --name dify python=3.10
# 切换至 dify Python 环境
conda activate dify
```

#### 启动步骤

1.  进入 api 目录

    ```
    cd api
    ```
2.  复制环境变量配置文件

    ```
    cp .env.example .env
    ```
3.  生成随机密钥，并替换 `.env` 中 `SECRET_KEY` 的值

    ```
    openssl rand -base64 42
    sed -i 's/SECRET_KEY=.*/SECRET_KEY=<your_value>/' .env
    ```
4.  安装依赖包

    ```
    pip install -r requirements.txt
    ```
5.  执行数据库迁移

    将数据库结构迁移至最新版本。

    ```
    flask db upgrade
    ```
6.  启动 API 服务

    ```
    flask run --host 0.0.0.0 --port=5001 --debug
    ```

    正确输出：

    ```
    * Debug mode: on
    INFO:werkzeug:WARNING: This is a development server. Do not use it in a production deployment. Use a production WSGI server instead.
     * Running on all addresses (0.0.0.0)
     * Running on http://127.0.0.1:5001
    INFO:werkzeug:Press CTRL+C to quit
    INFO:werkzeug: * Restarting with stat
    WARNING:werkzeug: * Debugger is active!
    INFO:werkzeug: * Debugger PIN: 695-801-919
    ```
7.  启动 Worker 服务

    用于消费一步队列任务，如数据集文件导入、更新数据集文档等异步操作。  Linux / MacOS 启动：

    ```
    celery -A app.celery worker -P gevent -c 1 -Q dataset,generation,mail --loglevel INFO
    ```

    如果使用 Windows 系统启动，请替换为该命令：

    ```
    celery -A app.celery worker -P solo --without-gossip --without-mingle -Q dataset,generation,mail --loglevel INFO
    ```

    正确输出：

    ```
     -------------- celery@TAKATOST.lan v5.2.7 (dawn-chorus)
    --- ***** ----- 
    -- ******* ---- macOS-10.16-x86_64-i386-64bit 2023-07-31 12:58:08
    - *** --- * --- 
    - ** ---------- [config]
    - ** ---------- .> app:         app:0x7fb568572a10
    - ** ---------- .> transport:   redis://:**@localhost:6379/1
    - ** ---------- .> results:     postgresql://postgres:**@localhost:5432/dify
    - *** --- * --- .> concurrency: 1 (gevent)
    -- ******* ---- .> task events: OFF (enable -E to monitor tasks in this worker)
    --- ***** ----- 
     -------------- [queues]
                    .> dataset          exchange=dataset(direct) key=dataset
                    .> generation       exchange=generation(direct) key=generation
                    .> mail             exchange=mail(direct) key=mail

    [tasks]
      . tasks.add_document_to_index_task.add_document_to_index_task
      . tasks.clean_dataset_task.clean_dataset_task
      . tasks.clean_document_task.clean_document_task
      . tasks.clean_notion_document_task.clean_notion_document_task
      . tasks.create_segment_to_index_task.create_segment_to_index_task
      . tasks.deal_dataset_vector_index_task.deal_dataset_vector_index_task
      . tasks.document_indexing_sync_task.document_indexing_sync_task
      . tasks.document_indexing_task.document_indexing_task
      . tasks.document_indexing_update_task.document_indexing_update_task
      . tasks.enable_segment_to_index_task.enable_segment_to_index_task
      . tasks.generate_conversation_summary_task.generate_conversation_summary_task
      . tasks.mail_invite_member_task.send_invite_member_mail_task
      . tasks.remove_document_from_index_task.remove_document_from_index_task
      . tasks.remove_segment_from_index_task.remove_segment_from_index_task
      . tasks.update_segment_index_task.update_segment_index_task
      . tasks.update_segment_keyword_index_task.update_segment_keyword_index_task

    [2023-07-31 12:58:08,831: INFO/MainProcess] Connected to redis://:**@localhost:6379/1
    [2023-07-31 12:58:08,840: INFO/MainProcess] mingle: searching for neighbors
    [2023-07-31 12:58:09,873: INFO/MainProcess] mingle: all alone
    [2023-07-31 12:58:09,886: INFO/MainProcess] pidbox: Connected to redis://:**@localhost:6379/1.
    [2023-07-31 12:58:09,890: INFO/MainProcess] celery@TAKATOST.lan ready.
    ```

***

### 前端页面部署

Web 前端客户端页面服务

#### 安装基础环境

Web 前端服务启动需要用到 [Node.js v18.x (LTS)](http://nodejs.org) 、[NPM 版本 8.x.x ](https://www.npmjs.com/)或 [Yarn](https://yarnpkg.com/)。

* 安装 NodeJS + NPM

进入 https://nodejs.org/en/download，选择对应操作系统的 v18.x 以上的安装包下载并安装，建议 stable 版本，已自带 NPM。

#### 启动步骤

1.  进入 web 目录

    ```
    cd web
    ```
2.  安装依赖包

    ```
    npm install
    ```
3.  配置环境变量。在当前目录下创建文件 `.env.local`，并复制`.env.example`中的内容。根据需求修改这些环境变量的值:

    ```
    # For production release, change this to PRODUCTION
    NEXT_PUBLIC_DEPLOY_ENV=DEVELOPMENT
    # The deployment edition, SELF_HOSTED or CLOUD
    NEXT_PUBLIC_EDITION=SELF_HOSTED
    # The base URL of console application, refers to the Console base URL of WEB service if console domain is
    # different from api or web app domain.
    # example: http://cloud.dify.ai/console/api
    NEXT_PUBLIC_API_PREFIX=http://localhost:5001/console/api
    # The URL for Web APP, refers to the Web App base URL of WEB service if web app domain is different from
    # console or api domain.
    # example: http://udify.app/api
    NEXT_PUBLIC_PUBLIC_API_PREFIX=http://localhost:5001/api

    # SENTRY
    NEXT_PUBLIC_SENTRY_DSN=
    NEXT_PUBLIC_SENTRY_ORG=
    NEXT_PUBLIC_SENTRY_PROJECT=
    ```
4.  构建代码

    ```
    npm run build
    ```
5.  启动 web 服务

    ```
    npm run start
    # or
    yarn start
    # or
    pnpm start
    ```

正常启动后，终端会输出如下信息：

```
ready - started server on 0.0.0.0:3000, url: http://localhost:3000
warn  - You have enabled experimental feature (appDir) in next.config.js.
warn  - Experimental features are not covered by semver, and may cause unexpected or broken application behavior. Use at your own risk.
info  - Thank you for testing `appDir` please leave your feedback at https://nextjs.link/app-feedback
```

### 访问 Dify

最后，访问 http://127.0.0.1:3000 即可使用本地部署的 Dify。
