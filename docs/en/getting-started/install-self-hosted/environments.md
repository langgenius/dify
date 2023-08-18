# Environments

### Common Variables

#### EDITION

Deployment version.

* `SELF_HOSTED`: Self-hosted version
  * Only supports single team/tenant mode
  * Can only use email and password to log in
  * No trial hosted OpenAI API-Key feature
* `CLOUD`: Cloud version
  * Supports multi-team/tenant mode
  * Unable to log in using email and password, only supports GitHub, Google authorization login.
  * Has 200 trials hosted OpenAI API-Key feature

#### CONSOLE_API_URL

The backend URL of the console API, used to concatenate the authorization callback. If empty, it is the same domain. Example: `https://api.console.dify.ai`

#### CONSOLE_WEB_URL

The front-end URL of the console web, used to concatenate some front-end addresses and for CORS configuration use. If empty, it is the same domain. Example: `https://console.dify.ai`

> Starting from version `0.3.8`, `CONSOLE_URL` has been split into `CONSOLE_API_URL` and `CONSOLE_WEB_URL`, but `CONSOLE_URL` is still available.

#### SERVICE_API_URL

Service API Url, used to display Service API Base Url to the front-end. If empty, it is the same domain. Example: `https://api.dify.ai`

> Starting from version `0.3.8`, `API_URL` has been renamed to `SERVICE_API_URL`, but `API_URL` is still available.

#### APP_API_URL

WebApp API backend Url, used to declare the back-end URL for the front-end API. If empty, it is the same domain. Example: `https://app.dify.ai`

#### APP_WEB_URL

WebApp Url, used to display WebAPP API Base Url to the front-end. If empty, it is the same domain. Example: `https://api.app.dify.ai`

> Starting from version `0.3.8`, `APP_URL` has been split into `APP_API_URL` and `APP_WEB_URL`, but `APP_URL` is still available.

### Server

#### MODE

Startup mode, only available when starting with docker, not effective when starting from source code.

*   api

    Start API Server.
*   worker

    Start asynchronous queue worker.

#### DEBUG

Debug mode, default is false. It is recommended to turn on this configuration for local development to prevent some problems caused by monkey patch.

#### FLASK_DEBUG

Flask debug mode, it can output trace information at the interface when turned on, which is convenient for debugging.

#### SECRET_KEY

A key used to securely sign session cookies and encrypt sensitive information in the database.

This variable needs to be set when starting for the first time.

You can use `openssl rand -base64 42` to generate a strong key.

#### DEPLOY_ENV

Deployment environment.

*   PRODUCTION (default)

    Production environment.
*   TESTING

    Testing environment. There will be a distinct color label on the front-end page, indicating that this environment is a testing environment.

#### LOG_LEVEL

Log output level, default is INFO.

It is recommended to set it to ERROR for production.

#### MIGRATION_ENABLED

When set to true, the database migration will be automatically executed when the container starts, only available when starting with docker, not effective when starting from source code.

You need to manually execute `flask db upgrade` in the api directory when starting from source code.

#### CHECK_UPDATE_URL

Whether to enable the version check policy. If set to false, `https://updates.dify.ai` will not be called for version check.

Since the version interface based on CloudFlare Worker cannot be directly accessed in China at present, setting this variable to empty can shield this interface call.

#### OPENAI_API_BASE

Used to change the OpenAI base address, default is [https://api.openai.com/v1](https://api.openai.com/v1).

When OpenAI cannot be accessed in China, replace it with a domestic mirror address, or when a local model provides OpenAI compatible API, it can be replaced.

#### Container Startup Related Configuration

Only effective when starting with docker image or docker-compose.

*   DIFY_BIND_ADDRESS

    API service binding address, default: 0.0.0.0, i.e., all addresses can be accessed.
*   DIFY_PORT

    API service binding port number, default 5001.
*   SERVER_WORKER_AMOUNT

    The number of API server workers, i.e., the number of gevent workers. Formula: `number of cpu cores x 2 + 1`

    Reference: [https://docs.gunicorn.org/en/stable/design.html#how-many-workers](https://docs.gunicorn.org/en/stable/design.html#how-many-workers)
*   SERVER_WORKER_CLASS

    Defaults to gevent. If using windows, it can be switched to sync or solo.
*   GUNICORN_TIMEOUT

    Request handling timeout. The default is 200, it is recommended to set it to 360 to support a longer sse connection time.
*   CELERY_WORKER_CLASS

    Similar to `SERVER_WORKER_CLASS`. Default is gevent. If using windows, it can be switched to sync or solo.
*   CELERY_WORKER_AMOUNT

    The number of Celery workers. The default is 1, and can be set as needed.

#### Database Configuration

The database uses PostgreSQL. Please use the public schema.

* DB_USERNAME: username
* DB_PASSWORD: password
* DB_HOST: database host
* DB_PORT: database port number, default is 5432
* DB_DATABASE: database name
* SQLALCHEMY_POOL_SIZE: The size of the database connection pool. The default is 30 connections, which can be appropriately increased.
* SQLALCHEMY_POOL_RECYCLE: Database connection pool recycling time, the default is 3600 seconds.
* SQLALCHEMY_ECHO: Whether to print SQL, default is false.

#### Redis Configuration

This Redis configuration is used for caching and for pub/sub during conversation.

* REDIS_HOST: Redis host
* REDIS_PORT: Redis port, default is 6379
* REDIS_DB: Redis Database, default is 0. Please use a different Database from Session Redis and Celery Broker.
* REDIS_USERNAME: Redis username, default is empty
* REDIS_PASSWORD: Redis password, default is empty. It is strongly recommended to set a password.
* REDIS_USE_SSL: Whether to use SSL protocol for connection, default is false

#### Session Configuration

Only used by the API service for interface identity verification.

*   SESSION_TYPE:

    Session component type

    *   redis (default)

        If you choose this, you need to set the environment variables starting with SESSION_REDIS_ below.
    *   sqlalchemy

        If you choose this, the current database connection will be used and the sessions table will be used to read and write session records.
* SESSION_REDIS_HOST: Redis host
* SESSION_REDIS_PORT: Redis port, default is 6379
* SESSION_REDIS_DB: Redis Database, default is 0. Please use a different Database from Redis and Celery Broker.
* SESSION_REDIS_USERNAME: Redis username, default is empty
* SESSION_REDIS_PASSWORD: Redis password, default is empty. It is strongly recommended to set a password.
* SESSION_REDIS_USE_SSL: Whether to use SSL protocol for connection, default is false

#### Celery Configuration

*   CELERY_BROKER_URL

    Format as follows:

    ```
    redis://<redis_username>:<redis_password>@<redis_host>:<redis_port>/<redis_database>
    ```

    Example: `redis://:difyai123456@redis:6379/1`
*   BROKER_USE_SSL

    If set to true, use SSL protocol for connection, default is false

#### CORS Configuration

Used to set the front-end cross-domain access policy.

*   CONSOLE_CORS_ALLOW_ORIGINS

    Console CORS cross-domain policy, default is `*`, that is, all domains can access.
*   WEB_API_CORS_ALLOW_ORIGINS

    WebAPP CORS cross-domain policy, default is `*`, that is, all domains can access.

For detailed configuration, please refer to: [Cross-domain/identity related guide](https://avytux375gg.feishu.cn/wiki/HyX3wdF1YiejX3k3U2CcTcmQnjg)

#### Cookie Policy Configuration

Used to set the browser policy for session cookies used for identity verification.

*   COOKIE_HTTPONLY

    Cookie HttpOnly configuration, default is true.
*   COOKIE_SAMESITE

    Cookie SameSite configuration, default is Lax.
*   COOKIE_SECURE

    Cookie Secure configuration, default is false.

For detailed configuration, please refer to: [Cross-domain/identity related guide](https://avytux375gg.feishu.cn/wiki/HyX3wdF1YiejX3k3U2CcTcmQnjg)

#### File Storage Configuration

Used to store uploaded data set files, team/tenant encryption keys, and other files.

*   STORAGE_TYPE

    Type of storage facility

    *   local (default)

        Local file storage, if this option is selected, the following `STORAGE_LOCAL_PATH` configuration needs to be set.
    *   s3

        S3 object storage, if this option is selected, the following S3_ prefixed configurations need to be set.
*   STORAGE_LOCAL_PATH

    Default is storage, that is, it is stored in the storage directory of the current directory.

    If you are deploying with docker or docker-compose, be sure to mount the `/app/api/storage` directory in both containers to the same local directory, otherwise, you may encounter file not found errors.
* S3_ENDPOINT: S3 endpoint address
* S3_BUCKET_NAME: S3 bucket name
* S3_ACCESS_KEY: S3 Access Key
* S3_SECRET_KEY: S3 Secret Key
* S3_REGION: S3 region information, such as: us-east-1

#### Vector Database Configuration

*   VECTOR_STORE

    The available enum types include: `weaviate`, `qdrant`, `pinecone`, `milvus` (the last two are not yet available)

    Both `milvus` and `zilliz` use the same configuration, both being `milvus`.
*   WEAVIATE_ENDPOINT

    Weaviate endpoint address, such as: `http://weaviate:8080`.
*   WEAVIATE_API_KEY

    The api-key credential used to connect to Weaviate.
*   WEAVIATE_BATCH_SIZE

    The number of index Objects created in batches in Weaviate, default is 100.

    Refer to this document: [https://weaviate.io/developers/weaviate/manage-data/import#how-to-set-batch-parameters](https://weaviate.io/developers/weaviate/manage-data/import#how-to-set-batch-parameters)
*   WEAVIATE_GRPC_ENABLED

    Whether to use the gRPC method to interact with Weaviate, performance will greatly increase when enabled, may not be usable locally, default is true.
*   QDRANT_URL

    Qdrant endpoint address, such as: `https://your-qdrant-cluster-url.qdrant.tech/`
*   QDRANT_API_KEY

    The api-key credential used to connect to Qdrant.
*   PINECONE_API_KEY

    The api-key credential used to connect to Pinecone.
*   PINECONE_ENVIRONMENT

    The environment where Pinecone is located, such as: `us-east4-gcp`
*   MILVUS_HOST

    Milvus host configuration.
*   MILVUS_PORT

    Milvus port configuration.
*   MILVUS_USER

    Milvus user configuration, default is empty.
*   MILVUS_PASSWORD

    Milvus password configuration, default is empty.
*   MILVUS_USE_SECURE

    Whether Milvus uses SSL connection, default is false.

#### Dataset Configuration

* UPLOAD_FILE_SIZE_LIMIT: 

  Upload file size limit, default 15M.
* UPLOAD_FILE_BATCH_LIMIT: 

  Number of files that can be uploaded in batch, default 5.


#### Sentry Configuration

Used for application monitoring and error log tracking.

*   SENTRY_DSN

    Sentry DSN address, default is empty, when empty, all monitoring information is not reported to Sentry.
*   SENTRY_TRACES_SAMPLE_RATE

    The reporting ratio of Sentry events, if it is 0.01, it is 1%.
*   SENTRY_PROFILES_SAMPLE_RATE

    The reporting ratio of Sentry profiles, if it is 0.01, it is 1%.

#### Notion Integration Configuration

Notion integration configuration, variables can be obtained by applying for Notion integration: [https://www.notion.so/my-integrations](https://www.notion.so/my-integrations)

* NOTION_CLIENT_ID
* NOTION_CLIENT_SECRET

#### Mail related configuration

*   MAIL_TYPE

    The type of mail provider, currently only supports: resend (https://resend.com). If left empty, no mail will be sent.
*   MAIL_DEFAULT_SEND_FROM

    The sender's email name, such as: no-reply [no-reply@dify.ai](mailto:no-reply@dify.ai), not mandatory.
*   RESEND_API_KEY

    API-Key for the Resend email provider, can be obtained from API-Key.

#### Third-Party Authorization Settings

Only available for cloud version.

* GITHUB_CLIENT_ID: GitHub authorization login Client ID
* GITHUB_CLIENT_SECRET: GitHub authorization login Client Secret
* GOOGLE_CLIENT_ID: Google authorization login Client ID
* GOOGLE_CLIENT_SECRET: Google authorization login Client Secret

#### Platform Hosting Model Related Configuration

Only available for cloud version, used for model hosting configuration.

* HOSTED_OPENAI_ENABLED: Enable OpenAI hosted service, default False
* HOSTED_OPENAI_API_KEY: OpenAI hosted service API key
* HOSTED_OPENAI_API_BASE: OpenAI hosted service API base URL, default is empty, i.e. `https://api.openai.com/v1`
* HOSTED_OPENAI_API_ORGANIZATION: OpenAI hosted service organization ID, default is empty
* HOSTED_OPENAI_QUOTA_LIMIT: OpenAI hosted service default trial quota (unit: call count), default 200 calls
* HOSTED_OPENAI_PAID_ENABLED: Enable OpenAI hosted paid service, default False
* HOSTED_OPENAI_PAID_STRIPE_PRICE_ID: OpenAI hosted paid service Stripe price ID
* HOSTED_OPENAI_PAID_INCREASE_QUOTA: Increase quota amount after payment for OpenAI hosted paid service
* HOSTED_AZURE_OPENAI_ENABLED: Enable Azure OpenAI hosted service, default False
* HOSTED_AZURE_OPENAI_API_KEY: Azure OpenAI hosted service API key
* HOSTED_AZURE_OPENAI_API_BASE: Azure OpenAI hosted service API base URL
* HOSTED_AZURE_OPENAI_QUOTA_LIMIT: Azure OpenAI hosted service default trial quota (unit: call count)
* HOSTED_ANTHROPIC_ENABLED: Enable Anthropic hosted service, default False
* HOSTED_ANTHROPIC_API_BASE: Anthropic hosted service API base URL, default is empty
* HOSTED_ANTHROPIC_API_KEY: Anthropic hosted service API key
* HOSTED_ANTHROPIC_QUOTA_LIMIT: Anthropic hosted service default trial quota (unit: tokens), default 600,000 tokens
* HOSTED_ANTHROPIC_PAID_ENABLED: Enable Anthropic hosted paid service, default False
* HOSTED_ANTHROPIC_PAID_STRIPE_PRICE_ID: Anthropic hosted paid service Stripe price ID
* HOSTED_ANTHROPIC_PAID_INCREASE_QUOTA: Increase quota amount for Anthropic hosted paid service
* HOSTED_ANTHROPIC_PAID_MIN_QUANTITY: Minimum purchase quantity for Anthropic hosted paid service
* HOSTED_ANTHROPIC_PAID_MAX_QUANTITY: Maximum purchase quantity for Anthropic hosted paid service
* STRIPE_API_KEY: Stripe's API key
* STRIPE_WEBHOOK_SECRET: Stripe's Webhook secret

***

### Web Frontend

#### SENTRY_DSN

Sentry DSN address, default is empty, when empty, all monitoring information is not reported to Sentry.
