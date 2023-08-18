# 环境变量说明

### 公共变量

#### EDITION

部署版本。

* `SELF_HOSTED`：自部署版本
  * 仅支持单团队/租户模式
  * 只能使用邮箱和密码方式登录
  * 无试用托管 OpenAI API-Key 功能
* `CLOUD`：云端版本
  * 支持多团队/租户模式
  * 无法使用邮箱和密码方式登录，仅支持 GitHub、Google 授权登录。
  * 有 200 次试用托管 OpenAI API-Key 功能

#### CONSOLE_API_URL

> 此变量单独作为控制台 API URL 配置，原 CONSOLE_URL 依旧可用。

控制台 API 后端 URL，用于拼接授权回调，传空则为同域。范例：`https://api.console.dify.ai`。

#### CONSOLE_WEB_URL

控制台 web **前端** URL，用于拼接部分前端地址，以及 CORS 配置使用，传空则为同域。范例：`https://console.dify.ai`

> 自 0.3.8 版本起，`CONSOLE_URL` 拆分为 `CONSOLE_API_URL` 和 `CONSOLE_WEB_URL`，`CONSOLE_URL` 依旧可用。

#### SERVICE_API_URL

Service API Url，用于**给前端**展示 Service API Base Url，传空则为同域。范例：`https://api.dify.ai`

> 自 0.3.8 版本起，`API_URL` 更名为 `SERVICE_API_URL`，`API_URL` 依旧可用。

#### APP_API_URL

WebApp API 后端 Url，用于声明**前端** API 后端地址，传空则为同域。范例：`https://app.dify.ai`

#### APP_WEB_URL

WebApp Url，用于**给前端**展示 WebAPP API Base Url，传空则为同域。范例：`https://api.app.dify.ai`

> 自 0.3.8 版本起，`APP_URL` 拆分为 `APP_API_URL` 和 `APP_WEB_URL`，`APP_URL` 依旧可用。

***

### 服务端

#### MODE

启动模式，仅使用 docker 启动时可用，源码启动无效。

* api

    启动 API Server。
* worker

    启动异步队列 worker。

#### DEBUG

调试模式，默认 false，建议本地开发打开该配置，可防止 monkey patch 导致的一些问题出现。

#### FLASK_DEBUG

Flask 调试模式，开启可在接口输出 trace 信息，方便调试。

#### SECRET_KEY

一个用于安全地签名会话 cookie 并在数据库上加密敏感信息的密钥。初次启动需要设置改变量。可以使用`openssl rand -base64 42`生成一个强密钥。

#### DEPLOY_ENV

部署环境。

* PRODUCTION（默认）

    生产环境。
* TESTING

    测试环境，前端页面会有明显颜色标识，该环境为测试环境。

#### LOG_LEVEL

日志输出等级，默认为 INFO。生产建议设置为 ERROR。

#### MIGRATION_ENABLED

当设置为 true 时，会在容器启动时自动执行数据库迁移，仅使用 docker 启动时可用，源码启动无效。源码启动需要在 api 目录手动执行 `flask db upgrade`。

#### CHECK_UPDATE_URL

是否开启检查版本策略，若设置为 false，则不调用 `https://updates.dify.ai` 进行版本检查。由于目前国内无法直接访问基于 CloudFlare Worker 的版本接口，设置该变量为空，可以屏蔽该接口调用。

#### OPENAI_API_BASE

用于更改 OpenAI 基础地址，默认为 https://api.openai.com/v1。
在国内无法访问 OpenAI，替换国内镜像地址，或者本地模型提供 OpenAI 兼容 API 时，可替换使用。

#### 容器启动相关配置

仅在使用 docker 镜像或者 docker-compose 启动时有效。

* DIFY_BIND_ADDRESS

    API 服务绑定地址，默认：0.0.0.0，即所有地址均可访问。
* DIFY_PORT

    API 服务绑定端口号，默认 5001。
* SERVER_WORKER_AMOUNT

    API 服务 Server worker 数量，即 gevent worker 数量，公式：`cpu 核心数 x 2 + 1`可参考：https://docs.gunicorn.org/en/stable/design.html#how-many-workers
* SERVER_WORKER_CLASS

    默认为 gevent，若为 windows，可以切换为 sync 或 solo。
* GUNICORN_TIMEOUT

    请求处理超时时间，默认 200，建议 360，以支持更长的 sse 连接时间。
* CELERY_WORKER_CLASS

    和 `SERVER_WORKER_CLASS` 类似，默认 gevent，若为 windows，可以切换为 sync 或 solo。
* CELERY_WORKER_AMOUNT

    Celery worker 数量，默认为 1，按需设置。

#### 数据库配置

数据库使用 PostgreSQL，请使用 public schema。

* DB_USERNAME：用户名
* DB_PASSWORD：密码
* DB_HOST：数据库 host
* DB_PORT：数据库端口号，默认 5432
* DB_DATABASE：数据库 database
* SQLALCHEMY_POOL_SIZE：数据库连接池大小，默认 30 个连接数，可适当增加。
* SQLALCHEMY_POOL_RECYCLE：数据库连接池回收时间，默认 3600 秒。
* SQLALCHEMY_ECHO：是否打印 SQL，默认 false。

#### Redis 配置

该 Redis 配置用于缓存以及对话时的 pub/sub。

* REDIS_HOST：Redis host
* REDIS_PORT：Redis port，默认 6379
* REDIS_DB：Redis Database，默认为 0，请和 Session Redis、Celery Broker 分开用不同 Database。
* REDIS_USERNAME：Redis 用户名，默认为空
* REDIS_PASSWORD：Redis 密码，默认为空，强烈建议设置密码。
* REDIS_USE_SSL：是否使用 SSL 协议进行连接，默认 false

#### Session 配置

仅 API 服务使用，用于验证接口身份。

* SESSION_TYPE：
    Session 组件类型
    * redis（默认）
  
        选择此项，则需要设置下方 SESSION_REDIS_ 开头的环境变量。
    * sqlalchemy
  
        选择此项，则使用当前数据库连接，并使用 sessions 表进行读写 session 记录。
* SESSION_REDIS_HOST：Redis host
* SESSION_REDIS_PORT：Redis port，默认 6379
* SESSION_REDIS_DB：Redis Database，默认为 0，请和 Redis、Celery Broker 分开用不同 Database。
* SESSION_REDIS_USERNAME：Redis 用户名，默认为空
* SESSION_REDIS_PASSWORD：Redis 密码，默认为空，强烈建议设置密码。
* SESSION_REDIS_USE_SSL：是否使用 SSL 协议进行连接，默认 false

#### Celery 配置

* CELERY_BROKER_URL

    格式如下

    <pre><code><strong>redis://&#x3C;redis_username>:&#x3C;redis_password>@&#x3C;redis_host>:&#x3C;redis_port>/&#x3C;redis_database>
    </strong></code></pre>

    范例：`redis://:difyai123456@redis:6379/1`
* BROKER_USE_SSL

    若设置为 true，则使用 SSL 协议进行连接，默认 false

#### CORS 配置

用于设置前端跨域访问策略。

* CONSOLE_CORS_ALLOW_ORIGINS

    控制台 CORS 跨域策略，默认为 `*`，即所有域名均可访问。
* WEB_API_CORS_ALLOW_ORIGINS

    WebAPP CORS 跨域策略，默认为 `*`，即所有域名均可访问。

详细配置可参考：[跨域/身份相关指南](https://avytux375gg.feishu.cn/wiki/HyX3wdF1YiejX3k3U2CcTcmQnjg)

#### Cookie 策略配置

用于设置身份校验的 Session Cookie 浏览器策略。

* COOKIE_HTTPONLY

    Cookie HttpOnly 配置，默认为 true。
* COOKIE_SAMESITE

    Cookie SameSite 配置，默认为 Lax。
* COOKIE_SECURE

    Cookie Secure 配置，默认为 false。详细配置可参考：[跨域/身份相关指南](https://avytux375gg.feishu.cn/wiki/HyX3wdF1YiejX3k3U2CcTcmQnjg)

#### 文件存储配置

用于存储数据集上传的文件、团队/租户的加密密钥等等文件。

* STORAGE_TYPE

    存储设施类型

    * local（默认）

        本地文件存储，若选择此项则需要设置下方 `STORAGE_LOCAL_PATH` 配置。
    * s3

        S3 对象存储，若选择此项则需要设置下方 S3_ 开头的配置。
* STORAGE_LOCAL_PATH

    默认为 storage，即存储在当前目录的 storage 目录下。若使用 docker 或 docker-compose 进行部署，请务必将两个容器中 `/app/api/storage` 目录挂载到同一个本机目录，否则可能会出现文件找不到的报错。
* S3_ENDPOINT：S3 端点地址
* S3_BUCKET_NAME：S3 桶名称
* S3_ACCESS_KEY：S3 Access Key
* S3_SECRET_KEY：S3 Secret Key
* S3_REGION：S3 地域信息，如：us-east-1

#### 向量数据库配置

* VECTOR_STORE

    可使用的枚举类型包括：`weaviate`、`qdrant`、`pinecone`、`milvus`（后两个暂未开放）其中 `milvus`和 `zilliz` 为同一套配置，均为 `milvus`。
* WEAVIATE_ENDPOINT

    Weaviate 端点地址，如：`http://weaviate:8080`。
* WEAVIATE_API_KEY

    连接 Weaviate 使用的 api-key 凭据。
* WEAVIATE_BATCH_SIZE

    Weaviate 批量创建索引 Object 的数量，默认 100。可参考此文档：https://weaviate.io/developers/weaviate/manage-data/import#how-to-set-batch-parameters
* WEAVIATE_GRPC_ENABLED

    是否使用 gRPC 方式与 Weaviate 进行交互，开启后性能会大大增加，本地可能无法使用，默认为 true。
* QDRANT_URL

    Qdrant 端点地址，如：`https://your-qdrant-cluster-url.qdrant.tech/`
* QDRANT_API_KEY

    连接 Qdrant 使用的 api-key 凭据。
* PINECONE_API_KEY

    连接 Pinecone 使用的 api-key 凭据。
* PINECONE_ENVIRONMENT

    Pinecone 所在的额环境，如：`us-east4-gcp`
* MILVUS_HOST

    Milvus host 配置。
* MILVUS_PORT

    Milvus post 配置。
* MILVUS_USER

    Milvus user 配置，默认为空。
* MILVUS_PASSWORD

    Milvus 密码配置，默认为空。
* MILVUS_USE_SECURE

    Milvus 是否使用 SSL 连接，默认 false。

#### 数据集配置

* UPLOAD_FILE_SIZE_LIMIT

  上传文件大小限制，默认 15M。
* UPLOAD_FILE_BATCH_LIMIT

  可批量上传文件数，默认 5。

#### Sentry 配置

用于应用监控和错误日志跟踪。

* SENTRY_DSN

    Sentry DSN 地址，默认为空，为空时则所有监控信息均不上报 Sentry。
* SENTRY_TRACES_SAMPLE_RATE

    Sentry events 的上报比例，若为 0.01，则为 1%。
* SENTRY_PROFILES_SAMPLE_RATE

    Sentry profiles 的上报比例，若为 0.01，则为 1%。

#### Notion 集成配置

Notion 集成配置，变量可通过申请 Notion integration 获取：[https://www.notion.so/my-integrations](https://www.notion.so/my-integrations)

* NOTION_CLIENT_ID
* NOTION_CLIENT_SECRET

#### 邮件相关配置

* MAIL_TYPE

    邮件提供商类型，当前仅支持：`resend`（[https://resend.com](https://resend.com)），留空则不发送邮件。
* MAIL_DEFAULT_SEND_FROM

    发件人邮箱名称，如：`no-reply <no-reply@dify.ai>`，非必填。
* RESEND_API_KEY

    Resend 邮件提供商 API-Key，可前往 [API-Key](https://resend.com/api-keys) 获取。

#### 第三方授权设置

仅云端版可用。

* GITHUB_CLIENT_ID：GitHub 授权登录 Client ID
* GITHUB_CLIENT_SECRET：GitHub 授权登录 Client Secret
* GOOGLE_CLIENT_ID：Google 授权登录 Client ID
* GOOGLE_CLIENT_SECRET：Google 授权登录 Client Secret

#### 平台托管模型相关配置

仅云端版可用，用于模型托管配置。

* HOSTED_OPENAI_ENABLED：启用 OpenAI 托管服务，默认 False
* HOSTED_OPENAI_API_KEY：OpenAI 托管服务的 API 密钥
* HOSTED_OPENAI_API_BASE：OpenAI 托管服务的 API 基础地址，默认为空，即使用：`https://api.openai.com/v1`
* HOSTED_OPENAI_API_ORGANIZATION：OpenAI 托管服务的组织 ID，默认为空
* HOSTED_OPENAI_QUOTA_LIMIT：OpenAI 托管服务的默认试用配额（单位：调用次数），默认 200 次调用
* HOSTED_OPENAI_PAID_ENABLED：启用 OpenAI 托管付费服务，默认 False
* HOSTED_OPENAI_PAID_STRIPE_PRICE_ID：OpenAI 托管付费服务的 Stripe 价格 ID
* HOSTED_OPENAI_PAID_INCREASE_QUOTA：OpenAI 托管付费服务的支付后，增加配额数量
* HOSTED_AZURE_OPENAI_ENABLED：启用 Azure OpenAI 托管服务，默认 False
* HOSTED_AZURE_OPENAI_API_KEY：Azure OpenAI 托管服务的 API 密钥
* HOSTED_AZURE_OPENAI_API_BASE：Azure OpenAI 托管服务的 API 基础地址
* HOSTED_AZURE_OPENAI_QUOTA_LIMIT：Azure OpenAI 托管服务的默认试用配额（单位：调用次数）
* HOSTED_ANTHROPIC_ENABLED：启用 Anthropic 托管服务，默认 False
* HOSTED_ANTHROPIC_API_BASE：Anthropic 托管服务的 API 基础地址，默认为空
* HOSTED_ANTHROPIC_API_KEY：Anthropic 托管服务的 API 密钥
* HOSTED_ANTHROPIC_QUOTA_LIMIT：Anthropic 托管服务的默认试用配额（单位：tokens），默认 600,000 tokens
* HOSTED_ANTHROPIC_PAID_ENABLED：启用 Anthropic 托管付费服务，默认 False
* HOSTED_ANTHROPIC_PAID_STRIPE_PRICE_ID：Anthropic 托管付费服务的 Stripe 价格 ID
* HOSTED_ANTHROPIC_PAID_INCREASE_QUOTA：Anthropic 托管付费服务的配额增加数量
* HOSTED_ANTHROPIC_PAID_MIN_QUANTITY：Anthropic 托管付费服务的最小购买份数
* HOSTED_ANTHROPIC_PAID_MAX_QUANTITY：Anthropic 托管付费服务的最大购买份数
* STRIPE_API_KEY：Stripe 的 API 密钥
* STRIPE_WEBHOOK_SECRET：Stripe 的 Webhook 密钥

***

### Web 前端

#### SENTRY_DSN

Sentry DSN 地址，默认为空，为空时则所有监控信息均不上报 Sentry。
