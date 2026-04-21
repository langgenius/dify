# Backend Env Reference

> Generated from `api/configs/**/*.py`. Do not edit manually.

This reference documents backend env input semantics and code defaults only.
Deployment defaults, `.env.example`, and runtime-effective values are intentionally excluded.

## Value Resolution Order

```text
init_settings > process_env > remote_settings > dotenv > file_secrets > toml > code_default
```

Code defaults are fallback values only. Runtime process environment, remote settings, and dotenv values can override them.

## `deploy.deployment`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `APPLICATION_NAME` | `string` | `"langgenius/dify"` | `APPLICATION_NAME` | Name of the application, used for identification and logging purposes |
| `DEBUG` | `boolean` | `false` | `DEBUG` | Enable debug mode for additional logging and development features |
| `DEPLOY_ENV` | `string` | `"PRODUCTION"` | `DEPLOY_ENV` | Deployment environment (e.g., 'PRODUCTION', 'DEVELOPMENT'), default to PRODUCTION |
| `EDITION` | `string` | `"SELF_HOSTED"` | `EDITION` | Deployment edition of the application (e.g., 'SELF_HOSTED', 'CLOUD') |
| `ENABLE_REQUEST_LOGGING` | `boolean` | `false` | `ENABLE_REQUEST_LOGGING` | Enable request and response body logging |

## `enterprise.enterprise-feature`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `CAN_REPLACE_LOGO` | `boolean` | `false` | `CAN_REPLACE_LOGO` | Allow customization of the enterprise logo. |
| `ENTERPRISE_ENABLED` | `boolean` | `false` | `ENTERPRISE_ENABLED` | Enable or disable enterprise-level features. Before using, please contact business@dify.ai by email to inquire about licensing matters. |
| `ENTERPRISE_REQUEST_TIMEOUT` | `integer` | `5` | `ENTERPRISE_REQUEST_TIMEOUT` | Maximum timeout in seconds for enterprise requests |

## `enterprise.enterprise-telemetry`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `ENTERPRISE_INCLUDE_CONTENT` | `boolean` | `false` | `ENTERPRISE_INCLUDE_CONTENT` | Include input/output content in traces (privacy toggle). |
| `ENTERPRISE_OTEL_SAMPLING_RATE` | `float` | `1.0` | `ENTERPRISE_OTEL_SAMPLING_RATE` | Sampling rate for enterprise traces (0.0 to 1.0, default 1.0 = 100%). |
| `ENTERPRISE_OTLP_API_KEY` | `string` | `""` | `ENTERPRISE_OTLP_API_KEY` | Bearer token for enterprise OTLP export authentication. |
| `ENTERPRISE_OTLP_ENDPOINT` | `string` | `""` | `ENTERPRISE_OTLP_ENDPOINT` | Enterprise OTEL collector endpoint. |
| `ENTERPRISE_OTLP_HEADERS` | `string` | `""` | `ENTERPRISE_OTLP_HEADERS` | Auth headers for OTLP export (key=value, key2=value2). |
| `ENTERPRISE_OTLP_PROTOCOL` | `string` | `"http"` | `ENTERPRISE_OTLP_PROTOCOL` | OTLP protocol: 'http' or 'grpc' (default: http). |
| `ENTERPRISE_SERVICE_NAME` | `string` | `"dify"` | `ENTERPRISE_SERVICE_NAME` | Service name for OTEL resource. |
| `ENTERPRISE_TELEMETRY_ENABLED` | `boolean` | `false` | `ENTERPRISE_TELEMETRY_ENABLED` | Enable enterprise telemetry collection (also requires ENTERPRISE_ENABLED=true). |

## `extra.archive-storage`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `ARCHIVE_STORAGE_ACCESS_KEY` | `string \| null` | `""` | `ARCHIVE_STORAGE_ACCESS_KEY` | Access key ID for authenticating with storage |
| `ARCHIVE_STORAGE_ARCHIVE_BUCKET` | `string \| null` | `""` | `ARCHIVE_STORAGE_ARCHIVE_BUCKET` | Name of the bucket to store archived workflow logs |
| `ARCHIVE_STORAGE_ENABLED` | `boolean` | `false` | `ARCHIVE_STORAGE_ENABLED` | Enable workflow run logs archiving to S3-compatible storage |
| `ARCHIVE_STORAGE_ENDPOINT` | `string \| null` | `""` | `ARCHIVE_STORAGE_ENDPOINT` | URL of the S3-compatible storage endpoint (e.g., 'https://storage.example.com') |
| `ARCHIVE_STORAGE_EXPORT_BUCKET` | `string \| null` | `""` | `ARCHIVE_STORAGE_EXPORT_BUCKET` | Name of the bucket to store exported workflow runs |
| `ARCHIVE_STORAGE_REGION` | `string` | `"auto"` | `ARCHIVE_STORAGE_REGION` | Region for storage (use 'auto' if the provider supports it) |
| `ARCHIVE_STORAGE_SECRET_KEY` | `string \| null` | `""` | `ARCHIVE_STORAGE_SECRET_KEY` | Secret access key for authenticating with storage |

## `extra.notion`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `NOTION_CLIENT_ID` | `string \| null` | `""` | `NOTION_CLIENT_ID` | Client ID for Notion API authentication. Required for OAuth 2.0 flow. |
| `NOTION_CLIENT_SECRET` | `string \| null` | `""` | `NOTION_CLIENT_SECRET` | Client secret for Notion API authentication. Required for OAuth 2.0 flow. |
| `NOTION_INTEGRATION_TOKEN` | `string \| null` | `""` | `NOTION_INTEGRATION_TOKEN` | Integration token for Notion API access. Used for direct API calls without OAuth flow. |
| `NOTION_INTEGRATION_TYPE` | `string \| null` | `""` | `NOTION_INTEGRATION_TYPE` | Type of Notion integration. Set to 'internal' for internal integrations, or None for public integrations. |
| `NOTION_INTERNAL_SECRET` | `string \| null` | `""` | `NOTION_INTERNAL_SECRET` | Secret key for internal Notion integrations. Required when NOTION_INTEGRATION_TYPE is 'internal'. |

## `extra.sentry`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `SENTRY_DSN` | `string \| null` | `""` | `SENTRY_DSN` | Sentry Data Source Name (DSN). This is the unique identifier of your Sentry project, used to send events to the correct project. |
| `SENTRY_PROFILES_SAMPLE_RATE` | `float` | `1.0` | `SENTRY_PROFILES_SAMPLE_RATE` | Sample rate for Sentry profiling. Value between 0.0 and 1.0, where 1.0 means 100% of profiles are sent to Sentry. |
| `SENTRY_TRACES_SAMPLE_RATE` | `float` | `1.0` | `SENTRY_TRACES_SAMPLE_RATE` | Sample rate for Sentry performance monitoring traces. Value between 0.0 and 1.0, where 1.0 means 100% of traces are sent to Sentry. |

## `feature.account`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `ACCOUNT_DELETION_TOKEN_EXPIRY_MINUTES` | `integer` | `5` | `ACCOUNT_DELETION_TOKEN_EXPIRY_MINUTES` | Duration in minutes for which an account deletion token remains valid. |
| `EDUCATION_ENABLED` | `boolean` | `false` | `EDUCATION_ENABLED` | Whether to enable education identity. |

## `feature.app-execution`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `APP_DEFAULT_ACTIVE_REQUESTS` | `integer` | `0` | `APP_DEFAULT_ACTIVE_REQUESTS` | Default number of concurrent active requests per app (0 for unlimited) |
| `APP_MAX_ACTIVE_REQUESTS` | `integer` | `0` | `APP_MAX_ACTIVE_REQUESTS` | Maximum number of concurrent active requests per app (0 for unlimited) |
| `APP_MAX_EXECUTION_TIME` | `integer` | `1200` | `APP_MAX_EXECUTION_TIME` | Maximum allowed execution time for the application in seconds |
| `HUMAN_INPUT_GLOBAL_TIMEOUT_SECONDS` | `integer` | `604800` | `HUMAN_INPUT_GLOBAL_TIMEOUT_SECONDS` | Maximum seconds a workflow run can stay paused waiting for human input before global timeout. |

## `feature.async-workflow`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `ASYNC_WORKFLOW_SCHEDULER_GRANULARITY` | `integer` | `120` | `ASYNC_WORKFLOW_SCHEDULER_GRANULARITY` | Granularity for the async workflow scheduler. Some users could block the queue with time-consuming tasks, so workflows can be suspended when needed. A time-based checker runs every granularity seconds to inspect the queue and suspend workflows. |

## `feature.auth`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `integer` | `60` | `ACCESS_TOKEN_EXPIRE_MINUTES` | Expiration time for access tokens in minutes |
| `CHANGE_EMAIL_LOCKOUT_DURATION` | `integer` | `86400` | `CHANGE_EMAIL_LOCKOUT_DURATION` | Time (in seconds) a user must wait before retrying change email after exceeding the rate limit. |
| `EMAIL_REGISTER_LOCKOUT_DURATION` | `integer` | `86400` | `EMAIL_REGISTER_LOCKOUT_DURATION` | Time (in seconds) a user must wait before retrying email register after exceeding the rate limit. |
| `FORGOT_PASSWORD_LOCKOUT_DURATION` | `integer` | `86400` | `FORGOT_PASSWORD_LOCKOUT_DURATION` | Time (in seconds) a user must wait before retrying password reset after exceeding the rate limit. |
| `GITHUB_CLIENT_ID` | `string \| null` | `""` | `GITHUB_CLIENT_ID` | GitHub OAuth client ID |
| `GITHUB_CLIENT_SECRET` | `string \| null` | `""` | `GITHUB_CLIENT_SECRET` | GitHub OAuth client secret |
| `GOOGLE_CLIENT_ID` | `string \| null` | `""` | `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | `string \| null` | `""` | `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `LOGIN_LOCKOUT_DURATION` | `integer` | `86400` | `LOGIN_LOCKOUT_DURATION` | Time (in seconds) a user must wait before retrying login after exceeding the rate limit. |
| `OAUTH_REDIRECT_PATH` | `string` | `"/console/api/oauth/authorize"` | `OAUTH_REDIRECT_PATH` | Redirect path for OAuth authentication callbacks |
| `OWNER_TRANSFER_LOCKOUT_DURATION` | `integer` | `86400` | `OWNER_TRANSFER_LOCKOUT_DURATION` | Time (in seconds) a user must wait before retrying owner transfer after exceeding the rate limit. |
| `REFRESH_TOKEN_EXPIRE_DAYS` | `float` | `30` | `REFRESH_TOKEN_EXPIRE_DAYS` | Expiration time for refresh tokens in days |

## `feature.billing`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `BILLING_ENABLED` | `boolean` | `false` | `BILLING_ENABLED` | Enable or disable billing functionality |

## `feature.celery-beat`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `CELERY_BEAT_SCHEDULER_TIME` | `integer` | `1` | `CELERY_BEAT_SCHEDULER_TIME` | Interval in days for Celery Beat scheduler execution, default to 1 day |

## `feature.celery-schedule-tasks`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `API_TOKEN_LAST_USED_UPDATE_INTERVAL` | `integer` | `30` | `API_TOKEN_LAST_USED_UPDATE_INTERVAL` | Interval in minutes for batch updating API token last_used_at (default 30) |
| `ENABLE_API_TOKEN_LAST_USED_UPDATE_TASK` | `boolean` | `true` | `ENABLE_API_TOKEN_LAST_USED_UPDATE_TASK` | Enable periodic batch update of API token last_used_at timestamps |
| `ENABLE_CHECK_UPGRADABLE_PLUGIN_TASK` | `boolean` | `true` | `ENABLE_CHECK_UPGRADABLE_PLUGIN_TASK` | Enable check upgradable plugin task |
| `ENABLE_CLEAN_EMBEDDING_CACHE_TASK` | `boolean` | `false` | `ENABLE_CLEAN_EMBEDDING_CACHE_TASK` | Enable clean embedding cache task |
| `ENABLE_CLEAN_MESSAGES` | `boolean` | `false` | `ENABLE_CLEAN_MESSAGES` | Enable clean messages task |
| `ENABLE_CLEAN_UNUSED_DATASETS_TASK` | `boolean` | `false` | `ENABLE_CLEAN_UNUSED_DATASETS_TASK` | Enable clean unused datasets task |
| `ENABLE_CREATE_TIDB_SERVERLESS_TASK` | `boolean` | `false` | `ENABLE_CREATE_TIDB_SERVERLESS_TASK` | Enable create tidb service job task |
| `ENABLE_DATASETS_QUEUE_MONITOR` | `boolean` | `false` | `ENABLE_DATASETS_QUEUE_MONITOR` | Enable queue monitor task |
| `ENABLE_HUMAN_INPUT_TIMEOUT_TASK` | `boolean` | `true` | `ENABLE_HUMAN_INPUT_TIMEOUT_TASK` | Enable human input timeout check task |
| `ENABLE_MAIL_CLEAN_DOCUMENT_NOTIFY_TASK` | `boolean` | `false` | `ENABLE_MAIL_CLEAN_DOCUMENT_NOTIFY_TASK` | Enable mail clean document notify task |
| `ENABLE_TRIGGER_PROVIDER_REFRESH_TASK` | `boolean` | `true` | `ENABLE_TRIGGER_PROVIDER_REFRESH_TASK` | Enable trigger provider refresh poller |
| `ENABLE_UPDATE_TIDB_SERVERLESS_STATUS_TASK` | `boolean` | `false` | `ENABLE_UPDATE_TIDB_SERVERLESS_STATUS_TASK` | Enable update tidb service job status task |
| `ENABLE_WORKFLOW_RUN_CLEANUP_TASK` | `boolean` | `false` | `ENABLE_WORKFLOW_RUN_CLEANUP_TASK` | Enable scheduled workflow run cleanup task |
| `ENABLE_WORKFLOW_SCHEDULE_POLLER_TASK` | `boolean` | `true` | `ENABLE_WORKFLOW_SCHEDULE_POLLER_TASK` | Enable workflow schedule poller task |
| `HUMAN_INPUT_TIMEOUT_TASK_INTERVAL` | `integer` | `1` | `HUMAN_INPUT_TIMEOUT_TASK_INTERVAL` | Human input timeout check interval in minutes |
| `TRIGGER_PROVIDER_CREDENTIAL_THRESHOLD_SECONDS` | `integer` | `3600` | `TRIGGER_PROVIDER_CREDENTIAL_THRESHOLD_SECONDS` | Proactive credential refresh threshold in seconds |
| `TRIGGER_PROVIDER_REFRESH_BATCH_SIZE` | `integer` | `200` | `TRIGGER_PROVIDER_REFRESH_BATCH_SIZE` | Max trigger subscriptions to process per tick |
| `TRIGGER_PROVIDER_REFRESH_INTERVAL` | `integer` | `1` | `TRIGGER_PROVIDER_REFRESH_INTERVAL` | Trigger provider refresh poller interval in minutes |
| `TRIGGER_PROVIDER_SUBSCRIPTION_THRESHOLD_SECONDS` | `integer` | `3600` | `TRIGGER_PROVIDER_SUBSCRIPTION_THRESHOLD_SECONDS` | Proactive subscription refresh threshold in seconds |
| `WORKFLOW_SCHEDULE_MAX_DISPATCH_PER_TICK` | `integer` | `0` | `WORKFLOW_SCHEDULE_MAX_DISPATCH_PER_TICK` | Maximum schedules to dispatch per tick (0=unlimited, circuit breaker) |
| `WORKFLOW_SCHEDULE_POLLER_BATCH_SIZE` | `integer` | `100` | `WORKFLOW_SCHEDULE_POLLER_BATCH_SIZE` | Maximum number of schedules to process in each poll batch |
| `WORKFLOW_SCHEDULE_POLLER_INTERVAL` | `integer` | `1` | `WORKFLOW_SCHEDULE_POLLER_INTERVAL` | Workflow schedule poller interval in minutes |

## `feature.code-execution-sandbox`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `CODE_EXECUTION_API_KEY` | `string` | `"dify-sandbox"` | `CODE_EXECUTION_API_KEY` | API key for accessing the code execution service |
| `CODE_EXECUTION_CONNECT_TIMEOUT` | `float \| null` | `10.0` | `CODE_EXECUTION_CONNECT_TIMEOUT` | Connection timeout in seconds for code execution requests |
| `CODE_EXECUTION_ENDPOINT` | `HttpUrl` | `"http://sandbox:8194/"` | `CODE_EXECUTION_ENDPOINT` | URL endpoint for the code execution service |
| `CODE_EXECUTION_POOL_KEEPALIVE_EXPIRY` | `typing.Annotated[float, Gt(gt=0)] \| null` | `5.0` | `CODE_EXECUTION_POOL_KEEPALIVE_EXPIRY` | Keep-alive expiry in seconds for idle connections (set to None to disable) |
| `CODE_EXECUTION_POOL_MAX_CONNECTIONS` | `integer` | `100` | `CODE_EXECUTION_POOL_MAX_CONNECTIONS` | Maximum number of concurrent connections for the code execution HTTP client |
| `CODE_EXECUTION_POOL_MAX_KEEPALIVE_CONNECTIONS` | `integer` | `20` | `CODE_EXECUTION_POOL_MAX_KEEPALIVE_CONNECTIONS` | Maximum number of persistent keep-alive connections for the code execution HTTP client |
| `CODE_EXECUTION_READ_TIMEOUT` | `float \| null` | `60.0` | `CODE_EXECUTION_READ_TIMEOUT` | Read timeout in seconds for code execution requests |
| `CODE_EXECUTION_SSL_VERIFY` | `boolean` | `true` | `CODE_EXECUTION_SSL_VERIFY` | Enable or disable SSL verification for code execution requests |
| `CODE_EXECUTION_WRITE_TIMEOUT` | `float \| null` | `10.0` | `CODE_EXECUTION_WRITE_TIMEOUT` | Write timeout in seconds for code execution request |
| `CODE_MAX_DEPTH` | `integer` | `5` | `CODE_MAX_DEPTH` | Maximum allowed depth for nested structures in code execution |
| `CODE_MAX_NUMBER` | `integer` | `9223372036854775807` | `CODE_MAX_NUMBER` | Maximum allowed numeric value in code execution |
| `CODE_MAX_NUMBER_ARRAY_LENGTH` | `integer` | `1000` | `CODE_MAX_NUMBER_ARRAY_LENGTH` | Maximum allowed length for numeric arrays in code execution |
| `CODE_MAX_OBJECT_ARRAY_LENGTH` | `integer` | `30` | `CODE_MAX_OBJECT_ARRAY_LENGTH` | Maximum allowed length for object arrays in code execution |
| `CODE_MAX_PRECISION` | `integer` | `20` | `CODE_MAX_PRECISION` | Maximum number of decimal places for floating-point numbers in code execution |
| `CODE_MAX_STRING_ARRAY_LENGTH` | `integer` | `30` | `CODE_MAX_STRING_ARRAY_LENGTH` | Maximum allowed length for string arrays in code execution |
| `CODE_MAX_STRING_LENGTH` | `integer` | `400000` | `CODE_MAX_STRING_LENGTH` | Maximum allowed length for strings in code execution |
| `CODE_MIN_NUMBER` | `integer` | `-9223372036854775807` | `CODE_MIN_NUMBER` | Minimum allowed numeric value in code execution |

## `feature.collaboration`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `ENABLE_COLLABORATION_MODE` | `boolean` | `false` | `ENABLE_COLLABORATION_MODE` | Whether to enable collaboration mode features across the workspace |

## `feature.data-set`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `CREATE_TIDB_SERVICE_JOB_ENABLED` | `boolean` | `false` | `CREATE_TIDB_SERVICE_JOB_ENABLED` | Enable or disable create tidb service job |
| `DATASET_MAX_SEGMENTS_PER_REQUEST` | `integer` | `0` | `DATASET_MAX_SEGMENTS_PER_REQUEST` | Maximum number of segments for dataset segments API (0 for unlimited) |
| `DATASET_OPERATOR_ENABLED` | `boolean` | `false` | `DATASET_OPERATOR_ENABLED` | Enable or disable dataset operator functionality |
| `DSL_EXPORT_ENCRYPT_DATASET_ID` | `boolean` | `true` | `DSL_EXPORT_ENCRYPT_DATASET_ID` | Enable or disable dataset ID encryption when exporting DSL files |
| `PLAN_PRO_CLEAN_DAY_SETTING` | `integer` | `7` | `PLAN_PRO_CLEAN_DAY_SETTING` | Interval in days for dataset cleanup operations - plan: pro and team |
| `PLAN_SANDBOX_CLEAN_DAY_SETTING` | `integer` | `30` | `PLAN_SANDBOX_CLEAN_DAY_SETTING` | Interval in days for dataset cleanup operations - plan: sandbox |
| `PLAN_SANDBOX_CLEAN_MESSAGE_DAY_SETTING` | `integer` | `30` | `PLAN_SANDBOX_CLEAN_MESSAGE_DAY_SETTING` | Interval in days for message cleanup operations - plan: sandbox |
| `TIDB_SERVERLESS_NUMBER` | `integer` | `500` | `TIDB_SERVERLESS_NUMBER` | number of tidb serverless cluster |

## `feature.endpoint`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `APP_WEB_URL` | `string` | `""` | `APP_WEB_URL` | Base URL for the web application, used for frontend references |
| `CONSOLE_API_URL` | `string` | `""` | `CONSOLE_API_URL` | Base URL for the console API, used for login authentication callback or notion integration callbacks |
| `CONSOLE_WEB_URL` | `string` | `""` | `CONSOLE_WEB_URL` | Base URL for the console web interface, used for frontend references and CORS configuration |
| `ENDPOINT_URL_TEMPLATE` | `string` | `"http://localhost:5002/e/{hook_id}"` | `ENDPOINT_URL_TEMPLATE` | Template url for endpoint plugin |
| `SERVICE_API_URL` | `string` | `""` | `SERVICE_API_URL` | Base URL for the service API, displayed to users for API access |
| `TRIGGER_URL` | `string` | `"http://localhost:5001"` | `TRIGGER_URL` | Template url for triggers |

## `feature.file-access`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `FILES_ACCESS_TIMEOUT` | `integer` | `300` | `FILES_ACCESS_TIMEOUT` | Expiration time in seconds for file access URLs |
| `FILES_URL` | `string` | `""` | `FILES_URL, CONSOLE_API_URL` | Base URL for file preview or download, used for frontend display and multi-model inputs. The URL is signed and has an expiration time. |
| `INTERNAL_FILES_URL` | `string` | `""` | `INTERNAL_FILES_URL` | Internal base URL for file access within Docker network, used for plugin daemon and internal service communication. Falls back to FILES_URL if not specified. |

## `feature.file-upload`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `ANNOTATION_IMPORT_FILE_SIZE_LIMIT` | `integer` | `2` | `ANNOTATION_IMPORT_FILE_SIZE_LIMIT` | Maximum allowed CSV file size for annotation import in megabytes |
| `ANNOTATION_IMPORT_MAX_CONCURRENT` | `integer` | `2` | `ANNOTATION_IMPORT_MAX_CONCURRENT` | Maximum number of concurrent annotation import tasks per tenant |
| `ANNOTATION_IMPORT_MAX_RECORDS` | `integer` | `10000` | `ANNOTATION_IMPORT_MAX_RECORDS` | Maximum number of annotation records allowed in a single import |
| `ANNOTATION_IMPORT_MIN_RECORDS` | `integer` | `1` | `ANNOTATION_IMPORT_MIN_RECORDS` | Minimum number of annotation records required in a single import |
| `ANNOTATION_IMPORT_RATE_LIMIT_PER_HOUR` | `integer` | `20` | `ANNOTATION_IMPORT_RATE_LIMIT_PER_HOUR` | Maximum number of annotation import requests per hour per tenant |
| `ANNOTATION_IMPORT_RATE_LIMIT_PER_MINUTE` | `integer` | `5` | `ANNOTATION_IMPORT_RATE_LIMIT_PER_MINUTE` | Maximum number of annotation import requests per minute per tenant |
| `ATTACHMENT_IMAGE_DOWNLOAD_TIMEOUT` | `integer` | `60` | `ATTACHMENT_IMAGE_DOWNLOAD_TIMEOUT` | Timeout for downloading image attachments in seconds |
| `ATTACHMENT_IMAGE_FILE_SIZE_LIMIT` | `integer` | `2` | `ATTACHMENT_IMAGE_FILE_SIZE_LIMIT` | Maximum allowed image file size for attachments in megabytes |
| `BATCH_UPLOAD_LIMIT` | `integer` | `20` | `BATCH_UPLOAD_LIMIT` | Maximum number of files allowed in a batch upload operation |
| `IMAGE_FILE_BATCH_LIMIT` | `integer` | `10` | `IMAGE_FILE_BATCH_LIMIT` | Maximum number of files allowed in a image batch upload operation |
| `SINGLE_CHUNK_ATTACHMENT_LIMIT` | `integer` | `10` | `SINGLE_CHUNK_ATTACHMENT_LIMIT` | Maximum number of files allowed in a single chunk attachment |
| `UPLOAD_AUDIO_FILE_SIZE_LIMIT` | `integer` | `50` | `UPLOAD_AUDIO_FILE_SIZE_LIMIT` | audio file size limit in Megabytes for uploading files |
| `UPLOAD_FILE_BATCH_LIMIT` | `integer` | `5` | `UPLOAD_FILE_BATCH_LIMIT` | Maximum number of files allowed in a single upload batch |
| `UPLOAD_FILE_SIZE_LIMIT` | `integer` | `15` | `UPLOAD_FILE_SIZE_LIMIT` | Maximum allowed file size for uploads in megabytes |
| `UPLOAD_IMAGE_FILE_SIZE_LIMIT` | `integer` | `10` | `UPLOAD_IMAGE_FILE_SIZE_LIMIT` | Maximum allowed image file size for uploads in megabytes |
| `UPLOAD_VIDEO_FILE_SIZE_LIMIT` | `integer` | `100` | `UPLOAD_VIDEO_FILE_SIZE_LIMIT` | video file size limit in Megabytes for uploading files |
| `WORKFLOW_FILE_UPLOAD_LIMIT` | `integer` | `10` | `WORKFLOW_FILE_UPLOAD_LIMIT` | Maximum number of files allowed in a workflow upload operation |

## `feature.hosted_service.hosted-anthropic`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `HOSTED_ANTHROPIC_API_BASE` | `string \| null` | `""` | `HOSTED_ANTHROPIC_API_BASE` | Base URL for hosted Anthropic API |
| `HOSTED_ANTHROPIC_API_KEY` | `string \| null` | `""` | `HOSTED_ANTHROPIC_API_KEY` | API key for hosted Anthropic service |
| `HOSTED_ANTHROPIC_PAID_ENABLED` | `boolean` | `false` | `HOSTED_ANTHROPIC_PAID_ENABLED` | Enable paid access to hosted Anthropic service |
| `HOSTED_ANTHROPIC_PAID_MODELS` | `string` | `"claude-opus-4-20250514,claude-sonnet-4-20250514,claude-3-5-haiku-20241022,claude-3-opus-20240229,claude-3-7-sonnet-20250219,claude-3-haiku-20240307"` | `HOSTED_ANTHROPIC_PAID_MODELS` | Comma-separated list of available models for paid access |
| `HOSTED_ANTHROPIC_TRIAL_ENABLED` | `boolean` | `false` | `HOSTED_ANTHROPIC_TRIAL_ENABLED` | Enable trial access to hosted Anthropic service |
| `HOSTED_ANTHROPIC_TRIAL_MODELS` | `string` | `"claude-opus-4-20250514,claude-sonnet-4-20250514,claude-3-5-haiku-20241022,claude-3-opus-20240229,claude-3-7-sonnet-20250219,claude-3-haiku-20240307"` | `HOSTED_ANTHROPIC_TRIAL_MODELS` | Comma-separated list of available models for paid access |

## `feature.hosted_service.hosted-azure-open-ai`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `HOSTED_AZURE_OPENAI_API_BASE` | `string \| null` | `""` | `HOSTED_AZURE_OPENAI_API_BASE` | Base URL for hosted Azure OpenAI API |
| `HOSTED_AZURE_OPENAI_API_KEY` | `string \| null` | `""` | `HOSTED_AZURE_OPENAI_API_KEY` | API key for hosted Azure OpenAI service |
| `HOSTED_AZURE_OPENAI_ENABLED` | `boolean` | `false` | `HOSTED_AZURE_OPENAI_ENABLED` | Enable hosted Azure OpenAI service |
| `HOSTED_AZURE_OPENAI_QUOTA_LIMIT` | `integer` | `200` | `HOSTED_AZURE_OPENAI_QUOTA_LIMIT` | Quota limit for hosted Azure OpenAI service usage |

## `feature.hosted_service.hosted-credit`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `HOSTED_MODEL_CREDIT_CONFIG` | `string` | `""` | `HOSTED_MODEL_CREDIT_CONFIG` | Model credit configuration in format 'model:credits, model:credits', e.g., 'gpt-4:20, gpt-4o:10' |
| `HOSTED_POOL_CREDITS` | `integer` | `200` | `HOSTED_POOL_CREDITS` | Pool credits for hosted service |

## `feature.hosted_service.hosted-deepseek`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `HOSTED_DEEPSEEK_API_BASE` | `string \| null` | `""` | `HOSTED_DEEPSEEK_API_BASE` | Base URL for hosted Deepseek API |
| `HOSTED_DEEPSEEK_API_KEY` | `string \| null` | `""` | `HOSTED_DEEPSEEK_API_KEY` | API key for hosted Deepseek service |
| `HOSTED_DEEPSEEK_API_ORGANIZATION` | `string \| null` | `""` | `HOSTED_DEEPSEEK_API_ORGANIZATION` | Organization ID for hosted Deepseek service |
| `HOSTED_DEEPSEEK_PAID_ENABLED` | `boolean` | `false` | `HOSTED_DEEPSEEK_PAID_ENABLED` | Enable paid access to hosted Deepseek service |
| `HOSTED_DEEPSEEK_PAID_MODELS` | `string` | `"deepseek-chat,deepseek-reasoner"` | `HOSTED_DEEPSEEK_PAID_MODELS` | Comma-separated list of available models for paid access |
| `HOSTED_DEEPSEEK_TRIAL_ENABLED` | `boolean` | `false` | `HOSTED_DEEPSEEK_TRIAL_ENABLED` | Enable trial access to hosted Deepseek service |
| `HOSTED_DEEPSEEK_TRIAL_MODELS` | `string` | `"deepseek-chat,deepseek-reasoner"` | `HOSTED_DEEPSEEK_TRIAL_MODELS` | Comma-separated list of available models for trial access |

## `feature.hosted_service.hosted-fetch-app-template`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `HOSTED_FETCH_APP_TEMPLATES_MODE` | `string` | `"remote"` | `HOSTED_FETCH_APP_TEMPLATES_MODE` | Mode for fetching app templates: remote, db, or builtin default to remote, |
| `HOSTED_FETCH_APP_TEMPLATES_REMOTE_DOMAIN` | `string` | `"https://tmpl.dify.ai"` | `HOSTED_FETCH_APP_TEMPLATES_REMOTE_DOMAIN` | Domain for fetching remote app templates |

## `feature.hosted_service.hosted-fetch-pipeline-template`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `HOSTED_FETCH_PIPELINE_TEMPLATES_MODE` | `string` | `"remote"` | `HOSTED_FETCH_PIPELINE_TEMPLATES_MODE` | Mode for fetching pipeline templates: remote, db, or builtin default to remote, |
| `HOSTED_FETCH_PIPELINE_TEMPLATES_REMOTE_DOMAIN` | `string` | `"https://tmpl.dify.ai"` | `HOSTED_FETCH_PIPELINE_TEMPLATES_REMOTE_DOMAIN` | Domain for fetching remote pipeline templates |

## `feature.hosted_service.hosted-gemini`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `HOSTED_GEMINI_API_BASE` | `string \| null` | `""` | `HOSTED_GEMINI_API_BASE` | Base URL for hosted Gemini API |
| `HOSTED_GEMINI_API_KEY` | `string \| null` | `""` | `HOSTED_GEMINI_API_KEY` | API key for hosted Gemini service |
| `HOSTED_GEMINI_API_ORGANIZATION` | `string \| null` | `""` | `HOSTED_GEMINI_API_ORGANIZATION` | Organization ID for hosted Gemini service |
| `HOSTED_GEMINI_PAID_ENABLED` | `boolean` | `false` | `HOSTED_GEMINI_PAID_ENABLED` | Enable paid access to hosted gemini service |
| `HOSTED_GEMINI_PAID_MODELS` | `string` | `"gemini-2.5-flash,gemini-2.0-flash,gemini-2.0-flash-lite,"` | `HOSTED_GEMINI_PAID_MODELS` | Comma-separated list of available models for paid access |
| `HOSTED_GEMINI_TRIAL_ENABLED` | `boolean` | `false` | `HOSTED_GEMINI_TRIAL_ENABLED` | Enable trial access to hosted Gemini service |
| `HOSTED_GEMINI_TRIAL_MODELS` | `string` | `"gemini-2.5-flash,gemini-2.0-flash,gemini-2.0-flash-lite,"` | `HOSTED_GEMINI_TRIAL_MODELS` | Comma-separated list of available models for trial access |

## `feature.hosted_service.hosted-minmax`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `HOSTED_MINIMAX_ENABLED` | `boolean` | `false` | `HOSTED_MINIMAX_ENABLED` | Enable hosted Minmax service |

## `feature.hosted_service.hosted-moderation`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `HOSTED_MODERATION_ENABLED` | `boolean` | `false` | `HOSTED_MODERATION_ENABLED` | Enable hosted Moderation service |
| `HOSTED_MODERATION_PROVIDERS` | `string` | `""` | `HOSTED_MODERATION_PROVIDERS` | Comma-separated list of moderation providers |

## `feature.hosted_service.hosted-open-ai`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `HOSTED_OPENAI_API_BASE` | `string \| null` | `""` | `HOSTED_OPENAI_API_BASE` | Base URL for hosted OpenAI API |
| `HOSTED_OPENAI_API_KEY` | `string \| null` | `""` | `HOSTED_OPENAI_API_KEY` | API key for hosted OpenAI service |
| `HOSTED_OPENAI_API_ORGANIZATION` | `string \| null` | `""` | `HOSTED_OPENAI_API_ORGANIZATION` | Organization ID for hosted OpenAI service |
| `HOSTED_OPENAI_PAID_ENABLED` | `boolean` | `false` | `HOSTED_OPENAI_PAID_ENABLED` | Enable paid access to hosted OpenAI service |
| `HOSTED_OPENAI_PAID_MODELS` | `string` | `"gpt-4,gpt-4-turbo-preview,gpt-4-turbo-2024-04-09,gpt-4-1106-preview,gpt-4-0125-preview,gpt-4-turbo,gpt-4.1,gpt-4.1-2025-04-14,gpt-4.1-mini,gpt-4.1-mini-2025-04-14,gpt-4.1-nano,gpt-4.1-nano-2025-04-14,gpt-3.5-turbo,gpt-3.5-turbo-16k,gpt-3.5-turbo-16k-0613,gpt-3.5-turbo-1106,gpt-3.5-turbo-0613,gpt-3.5-turbo-0125,gpt-3.5-turbo-instruct,text-davinci-003,chatgpt-4o-latest,gpt-4o,gpt-4o-2024-05-13,gpt-4o-2024-08-06,gpt-4o-2024-11-20,gpt-4o-audio-preview,gpt-4o-audio-preview-2025-06-03,gpt-4o-mini,gpt-4o-mini-2024-07-18,o3-mini,o3-mini-2025-01-31,gpt-5-mini-2025-08-07,gpt-5-mini,o4-mini,o4-mini-2025-04-16,gpt-5-chat-latest,gpt-5,gpt-5-2025-08-07,gpt-5-nano,gpt-5-nano-2025-08-07"` | `HOSTED_OPENAI_PAID_MODELS` | Comma-separated list of available models for paid access |
| `HOSTED_OPENAI_TRIAL_ENABLED` | `boolean` | `false` | `HOSTED_OPENAI_TRIAL_ENABLED` | Enable trial access to hosted OpenAI service |
| `HOSTED_OPENAI_TRIAL_MODELS` | `string` | `"gpt-4,gpt-4-turbo-preview,gpt-4-turbo-2024-04-09,gpt-4-1106-preview,gpt-4-0125-preview,gpt-4-turbo,gpt-4.1,gpt-4.1-2025-04-14,gpt-4.1-mini,gpt-4.1-mini-2025-04-14,gpt-4.1-nano,gpt-4.1-nano-2025-04-14,gpt-3.5-turbo,gpt-3.5-turbo-16k,gpt-3.5-turbo-16k-0613,gpt-3.5-turbo-1106,gpt-3.5-turbo-0613,gpt-3.5-turbo-0125,gpt-3.5-turbo-instruct,text-davinci-003,chatgpt-4o-latest,gpt-4o,gpt-4o-2024-05-13,gpt-4o-2024-08-06,gpt-4o-2024-11-20,gpt-4o-audio-preview,gpt-4o-audio-preview-2025-06-03,gpt-4o-mini,gpt-4o-mini-2024-07-18,o3-mini,o3-mini-2025-01-31,gpt-5-mini-2025-08-07,gpt-5-mini,o4-mini,o4-mini-2025-04-16,gpt-5-chat-latest,gpt-5,gpt-5-2025-08-07,gpt-5-nano,gpt-5-nano-2025-08-07"` | `HOSTED_OPENAI_TRIAL_MODELS` | Comma-separated list of available models for trial access |

## `feature.hosted_service.hosted-spark`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `HOSTED_SPARK_ENABLED` | `boolean` | `false` | `HOSTED_SPARK_ENABLED` | Enable hosted Spark service |

## `feature.hosted_service.hosted-tongyi`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `HOSTED_TONGYI_API_KEY` | `string \| null` | `""` | `HOSTED_TONGYI_API_KEY` | API key for hosted Tongyi service |
| `HOSTED_TONGYI_PAID_ENABLED` | `boolean` | `false` | `HOSTED_TONGYI_PAID_ENABLED` | Enable paid access to hosted Anthropic service |
| `HOSTED_TONGYI_PAID_MODELS` | `string` | `""` | `HOSTED_TONGYI_PAID_MODELS` | Comma-separated list of available models for paid access |
| `HOSTED_TONGYI_TRIAL_ENABLED` | `boolean` | `false` | `HOSTED_TONGYI_TRIAL_ENABLED` | Enable trial access to hosted Tongyi service |
| `HOSTED_TONGYI_TRIAL_MODELS` | `string` | `""` | `HOSTED_TONGYI_TRIAL_MODELS` | Comma-separated list of available models for trial access |
| `HOSTED_TONGYI_USE_INTERNATIONAL_ENDPOINT` | `boolean` | `false` | `HOSTED_TONGYI_USE_INTERNATIONAL_ENDPOINT` | Use international endpoint for hosted Tongyi service |

## `feature.hosted_service.hosted-x-a-i`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `HOSTED_XAI_API_BASE` | `string \| null` | `""` | `HOSTED_XAI_API_BASE` | Base URL for hosted XAI API |
| `HOSTED_XAI_API_KEY` | `string \| null` | `""` | `HOSTED_XAI_API_KEY` | API key for hosted XAI service |
| `HOSTED_XAI_API_ORGANIZATION` | `string \| null` | `""` | `HOSTED_XAI_API_ORGANIZATION` | Organization ID for hosted XAI service |
| `HOSTED_XAI_PAID_ENABLED` | `boolean` | `false` | `HOSTED_XAI_PAID_ENABLED` | Enable paid access to hosted XAI service |
| `HOSTED_XAI_PAID_MODELS` | `string` | `"grok-3,grok-3-mini,grok-3-mini-fast"` | `HOSTED_XAI_PAID_MODELS` | Comma-separated list of available models for paid access |
| `HOSTED_XAI_TRIAL_ENABLED` | `boolean` | `false` | `HOSTED_XAI_TRIAL_ENABLED` | Enable trial access to hosted XAI service |
| `HOSTED_XAI_TRIAL_MODELS` | `string` | `"grok-3,grok-3-mini,grok-3-mini-fast"` | `HOSTED_XAI_TRIAL_MODELS` | Comma-separated list of available models for trial access |

## `feature.hosted_service.hosted-zhipu-a-i`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `HOSTED_ZHIPUAI_ENABLED` | `boolean` | `false` | `HOSTED_ZHIPUAI_ENABLED` | Enable hosted ZhipuAI service |

## `feature.http`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `API_COMPRESSION_ENABLED` | `boolean` | `false` | `API_COMPRESSION_ENABLED` | Enable or disable gzip compression for HTTP responses |
| `COOKIE_DOMAIN` | `string` | `""` | `COOKIE_DOMAIN` | Explicit cookie domain for console/service cookies when sharing across subdomains |
| `HTTP_REQUEST_MAX_CONNECT_TIMEOUT` | `integer` | `10` | `HTTP_REQUEST_MAX_CONNECT_TIMEOUT` | Maximum connection timeout in seconds for HTTP requests |
| `HTTP_REQUEST_MAX_READ_TIMEOUT` | `integer` | `600` | `HTTP_REQUEST_MAX_READ_TIMEOUT` | Maximum read timeout in seconds for HTTP requests |
| `HTTP_REQUEST_MAX_WRITE_TIMEOUT` | `integer` | `600` | `HTTP_REQUEST_MAX_WRITE_TIMEOUT` | Maximum write timeout in seconds for HTTP requests |
| `HTTP_REQUEST_NODE_MAX_BINARY_SIZE` | `integer` | `10485760` | `HTTP_REQUEST_NODE_MAX_BINARY_SIZE` | Maximum allowed size in bytes for binary data in HTTP requests |
| `HTTP_REQUEST_NODE_MAX_TEXT_SIZE` | `integer` | `1048576` | `HTTP_REQUEST_NODE_MAX_TEXT_SIZE` | Maximum allowed size in bytes for text data in HTTP requests |
| `HTTP_REQUEST_NODE_SSL_VERIFY` | `boolean` | `true` | `HTTP_REQUEST_NODE_SSL_VERIFY` | Enable or disable SSL verification for HTTP requests |
| `RESPECT_XFORWARD_HEADERS_ENABLED` | `boolean` | `false` | `RESPECT_XFORWARD_HEADERS_ENABLED` | Enable handling of X-Forwarded-For, X-Forwarded-Proto, and X-Forwarded-Port headers when the app is behind a single trusted reverse proxy. |
| `SSRF_DEFAULT_CONNECT_TIME_OUT` | `float` | `5` | `SSRF_DEFAULT_CONNECT_TIME_OUT` | The default connect timeout period used for network requests (SSRF) |
| `SSRF_DEFAULT_MAX_RETRIES` | `integer` | `3` | `SSRF_DEFAULT_MAX_RETRIES` | Maximum number of retries for network requests (SSRF) |
| `SSRF_DEFAULT_READ_TIME_OUT` | `float` | `5` | `SSRF_DEFAULT_READ_TIME_OUT` | The default read timeout period used for network requests (SSRF) |
| `SSRF_DEFAULT_TIME_OUT` | `float` | `5` | `SSRF_DEFAULT_TIME_OUT` | The default timeout period used for network requests (SSRF) |
| `SSRF_DEFAULT_WRITE_TIME_OUT` | `float` | `5` | `SSRF_DEFAULT_WRITE_TIME_OUT` | The default write timeout period used for network requests (SSRF) |
| `SSRF_POOL_KEEPALIVE_EXPIRY` | `typing.Annotated[float, Gt(gt=0)] \| null` | `5.0` | `SSRF_POOL_KEEPALIVE_EXPIRY` | Keep-alive expiry in seconds for idle SSRF connections (set to None to disable) |
| `SSRF_POOL_MAX_CONNECTIONS` | `integer` | `100` | `SSRF_POOL_MAX_CONNECTIONS` | Maximum number of concurrent connections for the SSRF HTTP client |
| `SSRF_POOL_MAX_KEEPALIVE_CONNECTIONS` | `integer` | `20` | `SSRF_POOL_MAX_KEEPALIVE_CONNECTIONS` | Maximum number of persistent keep-alive connections for the SSRF HTTP client |
| `SSRF_PROXY_ALL_URL` | `string \| null` | `""` | `SSRF_PROXY_ALL_URL` | Proxy URL for HTTP or HTTPS requests to prevent Server-Side Request Forgery (SSRF) |
| `SSRF_PROXY_HTTPS_URL` | `string \| null` | `""` | `SSRF_PROXY_HTTPS_URL` | Proxy URL for HTTPS requests to prevent Server-Side Request Forgery (SSRF) |
| `SSRF_PROXY_HTTP_URL` | `string \| null` | `""` | `SSRF_PROXY_HTTP_URL` | Proxy URL for HTTP requests to prevent Server-Side Request Forgery (SSRF) |

## `feature.indexing`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `CHILD_CHUNKS_PREVIEW_NUMBER` | `integer` | `50` | `CHILD_CHUNKS_PREVIEW_NUMBER` | Maximum number of child chunks to preview |
| `INDEXING_MAX_SEGMENTATION_TOKENS_LENGTH` | `integer` | `4000` | `INDEXING_MAX_SEGMENTATION_TOKENS_LENGTH` | Maximum token length for text segmentation during indexing |

## `feature.inner-a-p-i`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `INNER_API` | `boolean` | `false` | `INNER_API` | Enable or disable the internal API |
| `INNER_API_KEY` | `string \| null` | `""` | `INNER_API_KEY` | API key for accessing the internal API |

## `feature.logging`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `LOG_DATEFORMAT` | `string \| null` | `""` | `LOG_DATEFORMAT` | Date format string for log timestamps |
| `LOG_FILE` | `string \| null` | `""` | `LOG_FILE` | File path for log output. |
| `LOG_FILE_BACKUP_COUNT` | `integer` | `5` | `LOG_FILE_BACKUP_COUNT` | Maximum file backup count file rotation retention |
| `LOG_FILE_MAX_SIZE` | `integer` | `20` | `LOG_FILE_MAX_SIZE` | Maximum file size for file rotation retention, the unit is megabytes (MB) |
| `LOG_FORMAT` | `string` | `"%(asctime)s.%(msecs)03d %(levelname)s [%(threadName)s] [%(filename)s:%(lineno)d] %(trace_id)s - %(message)s"` | `LOG_FORMAT` | Format string for log messages |
| `LOG_LEVEL` | `string` | `"INFO"` | `LOG_LEVEL` | Logging level, default to INFO. Set to ERROR for production environments. |
| `LOG_OUTPUT_FORMAT` | `literal['text', 'json']` | `"text"` | `LOG_OUTPUT_FORMAT` | Log output format: 'text' for human-readable, 'json' for structured JSON logs. |
| `LOG_TZ` | `string \| null` | `"UTC"` | `LOG_TZ` | Timezone for log timestamps (e.g., 'America/New_York') |

## `feature.login`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `ALLOW_CREATE_WORKSPACE` | `boolean` | `false` | `ALLOW_CREATE_WORKSPACE` | whether to enable create workspace |
| `ALLOW_REGISTER` | `boolean` | `false` | `ALLOW_REGISTER` | whether to enable register |
| `EMAIL_CODE_LOGIN_TOKEN_EXPIRY_MINUTES` | `integer` | `5` | `EMAIL_CODE_LOGIN_TOKEN_EXPIRY_MINUTES` | expiry time in minutes for email code login token |
| `ENABLE_EMAIL_CODE_LOGIN` | `boolean` | `false` | `ENABLE_EMAIL_CODE_LOGIN` | whether to enable email code login |
| `ENABLE_EMAIL_PASSWORD_LOGIN` | `boolean` | `true` | `ENABLE_EMAIL_PASSWORD_LOGIN` | whether to enable email password login |
| `ENABLE_SOCIAL_OAUTH_LOGIN` | `boolean` | `false` | `ENABLE_SOCIAL_OAUTH_LOGIN` | whether to enable github/google oauth login |

## `feature.mail`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `EMAIL_SEND_IP_LIMIT_PER_MINUTE` | `integer` | `50` | `EMAIL_SEND_IP_LIMIT_PER_MINUTE` | Maximum number of emails allowed to be sent from the same IP address in a minute |
| `ENABLE_EXPLORE_BANNER` | `boolean` | `false` | `ENABLE_EXPLORE_BANNER` | Enable explore banner |
| `ENABLE_TRIAL_APP` | `boolean` | `false` | `ENABLE_TRIAL_APP` | Enable trial app |
| `MAIL_DEFAULT_SEND_FROM` | `string \| null` | `""` | `MAIL_DEFAULT_SEND_FROM` | Default email address to use as the sender |
| `MAIL_TEMPLATING_MODE` | `enum` | `"sandbox"` | `MAIL_TEMPLATING_MODE` | Template mode for email services |
| `MAIL_TEMPLATING_TIMEOUT` | `integer` | `3` | `MAIL_TEMPLATING_TIMEOUT` | Timeout for email templating in seconds. Used to prevent infinite loops in malicious templates. Only available in sandbox mode. |
| `MAIL_TYPE` | `string \| null` | `""` | `MAIL_TYPE` | Email service provider type ('smtp' or 'resend' or 'sendGrid), default to None. |
| `RESEND_API_KEY` | `string \| null` | `""` | `RESEND_API_KEY` | API key for Resend email service |
| `RESEND_API_URL` | `string \| null` | `""` | `RESEND_API_URL` | API URL for Resend email service |
| `SENDGRID_API_KEY` | `string \| null` | `""` | `SENDGRID_API_KEY` | API key for SendGrid service |
| `SMTP_LOCAL_HOSTNAME` | `string \| null` | `""` | `SMTP_LOCAL_HOSTNAME` | Override the local hostname used in SMTP HELO/EHLO. Useful behind NAT or when the default hostname causes rejections. |
| `SMTP_OPPORTUNISTIC_TLS` | `boolean` | `false` | `SMTP_OPPORTUNISTIC_TLS` | Enable opportunistic TLS for SMTP connections |
| `SMTP_PASSWORD` | `string \| null` | `""` | `SMTP_PASSWORD` | Password for SMTP authentication |
| `SMTP_PORT` | `integer \| null` | `465` | `SMTP_PORT` | SMTP server port number |
| `SMTP_SERVER` | `string \| null` | `""` | `SMTP_SERVER` | SMTP server hostname |
| `SMTP_USERNAME` | `string \| null` | `""` | `SMTP_USERNAME` | Username for SMTP authentication |
| `SMTP_USE_TLS` | `boolean` | `false` | `SMTP_USE_TLS` | Enable TLS encryption for SMTP connections |

## `feature.marketplace`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `MARKETPLACE_API_URL` | `HttpUrl` | `"https://marketplace.dify.ai/"` | `MARKETPLACE_API_URL` | Marketplace API URL |
| `MARKETPLACE_ENABLED` | `boolean` | `true` | `MARKETPLACE_ENABLED` | Enable or disable marketplace |

## `feature.model-load-balance`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `MODEL_LB_ENABLED` | `boolean` | `false` | `MODEL_LB_ENABLED` | Enable or disable load balancing for models |
| `PLUGIN_BASED_TOKEN_COUNTING_ENABLED` | `boolean` | `false` | `PLUGIN_BASED_TOKEN_COUNTING_ENABLED` | Enable or disable plugin based token counting. If disabled, token counting will return 0. |

## `feature.moderation`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `MODERATION_BUFFER_SIZE` | `integer` | `300` | `MODERATION_BUFFER_SIZE` | Size of the buffer for content moderation processing |

## `feature.multi-modal-transfer`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `MULTIMODAL_SEND_FORMAT` | `literal['base64', 'url']` | `"base64"` | `MULTIMODAL_SEND_FORMAT` | Format for sending files in multimodal contexts ('base64' or 'url'), default is base64 |

## `feature.plugin`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `INNER_API_KEY_FOR_PLUGIN` | `string` | `"inner-api-key"` | `INNER_API_KEY_FOR_PLUGIN` | Inner api key for plugin |
| `PLUGIN_DAEMON_KEY` | `string` | `"plugin-api-key"` | `PLUGIN_DAEMON_KEY` | Plugin API key |
| `PLUGIN_DAEMON_TIMEOUT` | `typing.Annotated[float, Gt(gt=0)] \| null` | `600.0` | `PLUGIN_DAEMON_TIMEOUT` | Timeout in seconds for requests to the plugin daemon (set to None to disable) |
| `PLUGIN_DAEMON_URL` | `HttpUrl` | `"http://localhost:5002/"` | `PLUGIN_DAEMON_URL` | Plugin API URL |
| `PLUGIN_MAX_BUNDLE_SIZE` | `integer` | `188743680` | `PLUGIN_MAX_BUNDLE_SIZE` | Maximum allowed size for plugin bundles in bytes |
| `PLUGIN_MAX_FILE_SIZE` | `integer` | `52428800` | `PLUGIN_MAX_FILE_SIZE` | Maximum allowed size (bytes) for plugin-generated files |
| `PLUGIN_MAX_PACKAGE_SIZE` | `integer` | `15728640` | `PLUGIN_MAX_PACKAGE_SIZE` | Maximum allowed size for plugin packages in bytes |
| `PLUGIN_MODEL_SCHEMA_CACHE_TTL` | `integer` | `3600` | `PLUGIN_MODEL_SCHEMA_CACHE_TTL` | TTL in seconds for caching plugin model schemas in Redis |
| `PLUGIN_REMOTE_INSTALL_HOST` | `string` | `"localhost"` | `PLUGIN_REMOTE_INSTALL_HOST` | Plugin Remote Install Host |
| `PLUGIN_REMOTE_INSTALL_PORT` | `integer` | `5003` | `PLUGIN_REMOTE_INSTALL_PORT` | Plugin Remote Install Port |

## `feature.position`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `POSITION_PROVIDER_EXCLUDES` | `string` | `""` | `POSITION_PROVIDER_EXCLUDES` | Comma-separated list of excluded model providers |
| `POSITION_PROVIDER_INCLUDES` | `string` | `""` | `POSITION_PROVIDER_INCLUDES` | Comma-separated list of included model providers |
| `POSITION_PROVIDER_PINS` | `string` | `""` | `POSITION_PROVIDER_PINS` | Comma-separated list of pinned model providers |
| `POSITION_TOOL_EXCLUDES` | `string` | `""` | `POSITION_TOOL_EXCLUDES` | Comma-separated list of excluded tools |
| `POSITION_TOOL_INCLUDES` | `string` | `""` | `POSITION_TOOL_INCLUDES` | Comma-separated list of included tools |
| `POSITION_TOOL_PINS` | `string` | `""` | `POSITION_TOOL_PINS` | Comma-separated list of pinned tools |

## `feature.rag-etl`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `ETL_TYPE` | `string` | `"dify"` | `ETL_TYPE` | RAG ETL type ('dify' or 'Unstructured'), default to 'dify' |
| `KEYWORD_DATA_SOURCE_TYPE` | `string` | `"database"` | `KEYWORD_DATA_SOURCE_TYPE` | Data source type for keyword extraction ('database' or other supported types), default to 'database' |
| `SCARF_NO_ANALYTICS` | `string \| null` | `"false"` | `SCARF_NO_ANALYTICS` | This is about whether to disable Scarf analytics in Unstructured library. |
| `UNSTRUCTURED_API_KEY` | `string \| null` | `""` | `UNSTRUCTURED_API_KEY` | API key for Unstructured.io service |
| `UNSTRUCTURED_API_URL` | `string \| null` | `""` | `UNSTRUCTURED_API_URL` | API URL for Unstructured.io service |

## `feature.repository`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `API_WORKFLOW_NODE_EXECUTION_REPOSITORY` | `string` | `"repositories.sqlalchemy_api_workflow_node_execution_repository.DifyAPISQLAlchemyWorkflowNodeExecutionRepository"` | `API_WORKFLOW_NODE_EXECUTION_REPOSITORY` | Service-layer repository implementation for WorkflowNodeExecutionModel operations. Specify as a module path |
| `API_WORKFLOW_RUN_REPOSITORY` | `string` | `"repositories.sqlalchemy_api_workflow_run_repository.DifyAPISQLAlchemyWorkflowRunRepository"` | `API_WORKFLOW_RUN_REPOSITORY` | Service-layer repository implementation for WorkflowRun operations. Specify as a module path |
| `CORE_WORKFLOW_EXECUTION_REPOSITORY` | `string` | `"core.repositories.sqlalchemy_workflow_execution_repository.SQLAlchemyWorkflowExecutionRepository"` | `CORE_WORKFLOW_EXECUTION_REPOSITORY` | Repository implementation for WorkflowExecution. Options: 'core.repositories.sqlalchemy_workflow_execution_repository. SQLAlchemyWorkflowExecutionRepository' (default), 'core.repositories.celery_workflow_execution_repository. CeleryWorkflowExecutionRepository' |
| `CORE_WORKFLOW_NODE_EXECUTION_REPOSITORY` | `string` | `"core.repositories.sqlalchemy_workflow_node_execution_repository.SQLAlchemyWorkflowNodeExecutionRepository"` | `CORE_WORKFLOW_NODE_EXECUTION_REPOSITORY` | Repository implementation for WorkflowNodeExecution. Options: 'core.repositories.sqlalchemy_workflow_node_execution_repository. SQLAlchemyWorkflowNodeExecutionRepository' (default), 'core.repositories.celery_workflow_node_execution_repository. CeleryWorkflowNodeExecutionRepository' |

## `feature.sandbox-expired-records-clean`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `SANDBOX_EXPIRED_RECORDS_CLEAN_BATCH_MAX_INTERVAL` | `integer` | `200` | `SANDBOX_EXPIRED_RECORDS_CLEAN_BATCH_MAX_INTERVAL` | Maximum interval in milliseconds between batches |
| `SANDBOX_EXPIRED_RECORDS_CLEAN_BATCH_SIZE` | `integer` | `1000` | `SANDBOX_EXPIRED_RECORDS_CLEAN_BATCH_SIZE` | Maximum number of records to process in each batch |
| `SANDBOX_EXPIRED_RECORDS_CLEAN_GRACEFUL_PERIOD` | `integer` | `21` | `SANDBOX_EXPIRED_RECORDS_CLEAN_GRACEFUL_PERIOD` | Graceful period in days for sandbox records clean after subscription expiration |
| `SANDBOX_EXPIRED_RECORDS_CLEAN_TASK_LOCK_TTL` | `integer` | `90000` | `SANDBOX_EXPIRED_RECORDS_CLEAN_TASK_LOCK_TTL` | Lock TTL for sandbox expired records clean task in seconds |
| `SANDBOX_EXPIRED_RECORDS_RETENTION_DAYS` | `integer` | `30` | `SANDBOX_EXPIRED_RECORDS_RETENTION_DAYS` | Retention days for sandbox expired workflow_run records and message records |

## `feature.security`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `ADMIN_API_KEY` | `string \| null` | `""` | `ADMIN_API_KEY` | admin api key for authentication |
| `ADMIN_API_KEY_ENABLE` | `boolean` | `false` | `ADMIN_API_KEY_ENABLE` | Whether to enable admin api key for authentication |
| `CHANGE_EMAIL_TOKEN_EXPIRY_MINUTES` | `integer` | `5` | `CHANGE_EMAIL_TOKEN_EXPIRY_MINUTES` | Duration in minutes for which a change email token remains valid |
| `EMAIL_REGISTER_TOKEN_EXPIRY_MINUTES` | `integer` | `5` | `EMAIL_REGISTER_TOKEN_EXPIRY_MINUTES` | Duration in minutes for which a email register token remains valid |
| `LOGIN_DISABLED` | `boolean` | `false` | `LOGIN_DISABLED` | Whether to disable login checks |
| `OWNER_TRANSFER_TOKEN_EXPIRY_MINUTES` | `integer` | `5` | `OWNER_TRANSFER_TOKEN_EXPIRY_MINUTES` | Duration in minutes for which a owner transfer token remains valid |
| `RESET_PASSWORD_TOKEN_EXPIRY_MINUTES` | `integer` | `5` | `RESET_PASSWORD_TOKEN_EXPIRY_MINUTES` | Duration in minutes for which a password reset token remains valid |
| `SECRET_KEY` | `string` | `""` | `SECRET_KEY` | Secret key for secure session cookie signing. Make sure you are changing this key for your deployment with a strong key. Generate a strong key using `openssl rand -base64 42` or set via the `SECRET_KEY` environment variable. |
| `WEB_FORM_SUBMIT_RATE_LIMIT_MAX_ATTEMPTS` | `integer` | `30` | `WEB_FORM_SUBMIT_RATE_LIMIT_MAX_ATTEMPTS` | Maximum number of web form submissions allowed per IP within the rate limit window |
| `WEB_FORM_SUBMIT_RATE_LIMIT_WINDOW_SECONDS` | `integer` | `60` | `WEB_FORM_SUBMIT_RATE_LIMIT_WINDOW_SECONDS` | Time window in seconds for web form submission rate limiting |

## `feature.swagger-u-i`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `SWAGGER_UI_ENABLED` | `boolean` | `true` | `SWAGGER_UI_ENABLED` | Whether to enable Swagger UI in api module |
| `SWAGGER_UI_PATH` | `string` | `"/swagger-ui.html"` | `SWAGGER_UI_PATH` | Swagger UI page path in api module |

## `feature.tenant-isolated-task-queue`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `TENANT_ISOLATED_TASK_CONCURRENCY` | `integer` | `1` | `TENANT_ISOLATED_TASK_CONCURRENCY` | Number of tasks allowed to be delivered concurrently from isolated queue per tenant |

## `feature.tool`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `TOOL_ICON_CACHE_MAX_AGE` | `integer` | `3600` | `TOOL_ICON_CACHE_MAX_AGE` | Maximum age in seconds for caching tool icons |

## `feature.trigger`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `WEBHOOK_REQUEST_BODY_MAX_SIZE` | `integer` | `10485760` | `WEBHOOK_REQUEST_BODY_MAX_SIZE` | Maximum allowed size for webhook request bodies in bytes |

## `feature.update`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `CHECK_UPDATE_URL` | `string` | `"https://updates.dify.ai"` | `CHECK_UPDATE_URL` | URL to check for application updates |

## `feature.workflow`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `GRAPH_ENGINE_MAX_WORKERS` | `integer` | `10` | `GRAPH_ENGINE_MAX_WORKERS` | Maximum number of workers per GraphEngine instance |
| `GRAPH_ENGINE_MIN_WORKERS` | `integer` | `1` | `GRAPH_ENGINE_MIN_WORKERS` | Minimum number of workers per GraphEngine instance |
| `GRAPH_ENGINE_SCALE_DOWN_IDLE_TIME` | `float` | `5.0` | `GRAPH_ENGINE_SCALE_DOWN_IDLE_TIME` | Seconds of idle time before scaling down workers |
| `GRAPH_ENGINE_SCALE_UP_THRESHOLD` | `integer` | `3` | `GRAPH_ENGINE_SCALE_UP_THRESHOLD` | Queue depth threshold that triggers worker scale up |
| `MAX_VARIABLE_SIZE` | `integer` | `204800` | `MAX_VARIABLE_SIZE` | Maximum size in bytes for a single variable in workflows. Default to 200 KB. |
| `TEMPLATE_TRANSFORM_MAX_LENGTH` | `integer` | `400000` | `TEMPLATE_TRANSFORM_MAX_LENGTH` | Maximum number of characters allowed in Template Transform node output |
| `WORKFLOW_CALL_MAX_DEPTH` | `integer` | `5` | `WORKFLOW_CALL_MAX_DEPTH` | Maximum allowed depth for nested workflow calls |
| `WORKFLOW_MAX_EXECUTION_STEPS` | `integer` | `500` | `WORKFLOW_MAX_EXECUTION_STEPS` | Maximum number of steps allowed in a single workflow execution |
| `WORKFLOW_MAX_EXECUTION_TIME` | `integer` | `1200` | `WORKFLOW_MAX_EXECUTION_TIME` | Maximum execution time in seconds for a single workflow |

## `feature.workflow-log`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `WORKFLOW_LOG_CLEANUP_BATCH_SIZE` | `integer` | `100` | `WORKFLOW_LOG_CLEANUP_BATCH_SIZE` | Batch size for workflow run log cleanup operations |
| `WORKFLOW_LOG_CLEANUP_ENABLED` | `boolean` | `false` | `WORKFLOW_LOG_CLEANUP_ENABLED` | Enable workflow run log cleanup |
| `WORKFLOW_LOG_CLEANUP_SPECIFIC_WORKFLOW_IDS` | `string` | `""` | `WORKFLOW_LOG_CLEANUP_SPECIFIC_WORKFLOW_IDS` | Comma-separated list of workflow IDs to clean logs for |
| `WORKFLOW_LOG_RETENTION_DAYS` | `integer` | `30` | `WORKFLOW_LOG_RETENTION_DAYS` | Retention days for workflow run logs |

## `feature.workflow-node-execution`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `MAX_SUBMIT_COUNT` | `integer` | `100` | `MAX_SUBMIT_COUNT` | Maximum number of submitted thread count in a ThreadPool for parallel node execution |
| `WORKFLOW_NODE_EXECUTION_STORAGE` | `string` | `"rdbms"` | `WORKFLOW_NODE_EXECUTION_STORAGE` | Storage backend for WorkflowNodeExecution. Options: 'rdbms', 'hybrid' |

## `feature.workflow-variable-truncation`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `WORKFLOW_VARIABLE_TRUNCATION_ARRAY_LENGTH` | `integer` | `1000` | `WORKFLOW_VARIABLE_TRUNCATION_ARRAY_LENGTH` | maximum length for array to trigger truncation. |
| `WORKFLOW_VARIABLE_TRUNCATION_MAX_SIZE` | `integer` | `1024000` | `WORKFLOW_VARIABLE_TRUNCATION_MAX_SIZE` | Maximum size for variable to trigger final truncation. |
| `WORKFLOW_VARIABLE_TRUNCATION_STRING_LENGTH` | `integer` | `100000` | `WORKFLOW_VARIABLE_TRUNCATION_STRING_LENGTH` | maximum length for string to trigger tuncation, measure in number of characters |

## `feature.workspace`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `INVITE_EXPIRY_HOURS` | `integer` | `72` | `INVITE_EXPIRY_HOURS` | Expiration time in hours for workspace invitation links |

## `middleware.cache.redis`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `REDIS_CLUSTERS` | `string \| null` | `""` | `REDIS_CLUSTERS` | Comma-separated list of Redis Clusters nodes (host:port) |
| `REDIS_CLUSTERS_PASSWORD` | `string \| null` | `""` | `REDIS_CLUSTERS_PASSWORD` | Password for Redis Clusters authentication (if required) |
| `REDIS_DB` | `integer` | `0` | `REDIS_DB` | Redis database number to use (0-15) |
| `REDIS_ENABLE_CLIENT_SIDE_CACHE` | `boolean` | `false` | `REDIS_ENABLE_CLIENT_SIDE_CACHE` | Enable client side cache in redis |
| `REDIS_HEALTH_CHECK_INTERVAL` | `integer` | `30` | `REDIS_HEALTH_CHECK_INTERVAL` | Interval in seconds between Redis connection health checks (0 to disable) |
| `REDIS_HOST` | `string` | `"localhost"` | `REDIS_HOST` | Hostname or IP address of the Redis server |
| `REDIS_KEY_PREFIX` | `string` | `""` | `REDIS_KEY_PREFIX` | Optional global prefix for Redis keys, topics, and transport artifacts |
| `REDIS_MAX_CONNECTIONS` | `typing.Annotated[int, Gt(gt=0)] \| null` | `""` | `REDIS_MAX_CONNECTIONS` | Maximum connections in the Redis connection pool (unset for library default) |
| `REDIS_PASSWORD` | `string \| null` | `""` | `REDIS_PASSWORD` | Password for Redis authentication (if required) |
| `REDIS_PORT` | `integer` | `6379` | `REDIS_PORT` | Port number on which the Redis server is listening |
| `REDIS_RETRY_BACKOFF_BASE` | `float` | `1.0` | `REDIS_RETRY_BACKOFF_BASE` | Base delay in seconds for exponential backoff between retries |
| `REDIS_RETRY_BACKOFF_CAP` | `float` | `10.0` | `REDIS_RETRY_BACKOFF_CAP` | Maximum backoff delay in seconds between retries |
| `REDIS_RETRY_RETRIES` | `integer` | `3` | `REDIS_RETRY_RETRIES` | Maximum number of retries per Redis command on transient failures (ConnectionError, TimeoutError, socket.timeout) |
| `REDIS_SENTINELS` | `string \| null` | `""` | `REDIS_SENTINELS` | Comma-separated list of Redis Sentinel nodes (host:port) |
| `REDIS_SENTINEL_PASSWORD` | `string \| null` | `""` | `REDIS_SENTINEL_PASSWORD` | Password for Redis Sentinel authentication (if required) |
| `REDIS_SENTINEL_SERVICE_NAME` | `string \| null` | `""` | `REDIS_SENTINEL_SERVICE_NAME` | Name of the Redis Sentinel service to monitor |
| `REDIS_SENTINEL_SOCKET_TIMEOUT` | `typing.Annotated[float, Gt(gt=0)] \| null` | `0.1` | `REDIS_SENTINEL_SOCKET_TIMEOUT` | Socket timeout in seconds for Redis Sentinel connections |
| `REDIS_SENTINEL_USERNAME` | `string \| null` | `""` | `REDIS_SENTINEL_USERNAME` | Username for Redis Sentinel authentication (if required) |
| `REDIS_SERIALIZATION_PROTOCOL` | `integer` | `3` | `REDIS_SERIALIZATION_PROTOCOL` | Redis serialization protocol (RESP) version |
| `REDIS_SOCKET_CONNECT_TIMEOUT` | `typing.Annotated[float, Gt(gt=0)] \| null` | `5.0` | `REDIS_SOCKET_CONNECT_TIMEOUT` | Socket timeout in seconds for Redis connection establishment |
| `REDIS_SOCKET_TIMEOUT` | `typing.Annotated[float, Gt(gt=0)] \| null` | `5.0` | `REDIS_SOCKET_TIMEOUT` | Socket timeout in seconds for Redis read/write operations |
| `REDIS_SSL_CA_CERTS` | `string \| null` | `""` | `REDIS_SSL_CA_CERTS` | Path to the CA certificate file for SSL verification |
| `REDIS_SSL_CERTFILE` | `string \| null` | `""` | `REDIS_SSL_CERTFILE` | Path to the client certificate file for SSL authentication |
| `REDIS_SSL_CERT_REQS` | `string` | `"CERT_NONE"` | `REDIS_SSL_CERT_REQS` | SSL certificate requirements (CERT_NONE, CERT_OPTIONAL, CERT_REQUIRED) |
| `REDIS_SSL_KEYFILE` | `string \| null` | `""` | `REDIS_SSL_KEYFILE` | Path to the client private key file for SSL authentication |
| `REDIS_USERNAME` | `string \| null` | `""` | `REDIS_USERNAME` | Username for Redis authentication (if required) |
| `REDIS_USE_CLUSTERS` | `boolean` | `false` | `REDIS_USE_CLUSTERS` | Enable Redis Clusters mode for high availability |
| `REDIS_USE_SENTINEL` | `boolean \| null` | `false` | `REDIS_USE_SENTINEL` | Enable Redis Sentinel mode for high availability |
| `REDIS_USE_SSL` | `boolean` | `false` | `REDIS_USE_SSL` | Enable SSL/TLS for the Redis connection |

## `middleware.cache.redis-pub-sub`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `PUBSUB_REDIS_CHANNEL_TYPE` | `literal['pubsub', 'sharded', 'streams']` | `"pubsub"` | `EVENT_BUS_REDIS_CHANNEL_TYPE, PUBSUB_REDIS_CHANNEL_TYPE` | Event transport type. Options are: - pubsub: normal Pub/Sub (at-most-once) - sharded: sharded Pub/Sub (at-most-once) - streams: Redis Streams (at-least-once, recommended to avoid subscriber races) Note: Before enabling 'streams' in production, estimate your expected event volume and retention needs. Configure Redis memory limits and stream trimming appropriately (e.g., MAXLEN and key expiry) to reduce the risk of data loss from Redis auto-eviction under memory pressure. Also accepts ENV: EVENT_BUS_REDIS_CHANNEL_TYPE. |
| `PUBSUB_REDIS_URL` | `string \| null` | `""` | `EVENT_BUS_REDIS_URL, PUBSUB_REDIS_URL` | Redis connection URL for streaming events between API and celery worker; defaults to URL constructed from `REDIS_*` configurations. Also accepts ENV: EVENT_BUS_REDIS_URL. |
| `PUBSUB_REDIS_USE_CLUSTERS` | `boolean` | `false` | `EVENT_BUS_REDIS_USE_CLUSTERS, PUBSUB_REDIS_USE_CLUSTERS` | Enable Redis Cluster mode for pub/sub or streams transport. Recommended for large deployments. Also accepts ENV: EVENT_BUS_REDIS_USE_CLUSTERS. |
| `PUBSUB_STREAMS_RETENTION_SECONDS` | `integer` | `600` | `EVENT_BUS_STREAMS_RETENTION_SECONDS, PUBSUB_STREAMS_RETENTION_SECONDS` | When using 'streams', expire each stream key this many seconds after the last event is published. Also accepts ENV: EVENT_BUS_STREAMS_RETENTION_SECONDS. |

## `middleware.celery`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `CELERY_BACKEND` | `string` | `"redis"` | `CELERY_BACKEND` | Backend for Celery task results. Options: 'database', 'redis', 'rabbitmq'. |
| `CELERY_BROKER_URL` | `string \| null` | `""` | `CELERY_BROKER_URL` | URL of the message broker for Celery tasks. |
| `CELERY_SENTINEL_MASTER_NAME` | `string \| null` | `""` | `CELERY_SENTINEL_MASTER_NAME` | Name of the Redis Sentinel master. |
| `CELERY_SENTINEL_PASSWORD` | `string \| null` | `""` | `CELERY_SENTINEL_PASSWORD` | Password of the Redis Sentinel master. |
| `CELERY_SENTINEL_SOCKET_TIMEOUT` | `typing.Annotated[float, Gt(gt=0)] \| null` | `0.1` | `CELERY_SENTINEL_SOCKET_TIMEOUT` | Timeout for Redis Sentinel socket operations in seconds. |
| `CELERY_TASK_ANNOTATIONS` | `dict[str, typing.Any] \| null` | `""` | `CELERY_TASK_ANNOTATIONS` | Annotations for Celery tasks as a JSON mapping of task name -> options (for example, rate limits or other task-specific settings). |
| `CELERY_USE_SENTINEL` | `boolean \| null` | `false` | `CELERY_USE_SENTINEL` | Whether to use Redis Sentinel for high availability. |

## `middleware.database`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `DB_CHARSET` | `string` | `""` | `DB_CHARSET` | Character set for database connection. |
| `DB_DATABASE` | `string` | `"dify"` | `DB_DATABASE` | Name of the database to connect to. |
| `DB_EXTRAS` | `string` | `""` | `DB_EXTRAS` | Additional database connection parameters. Example: 'keepalives_idle=60&keepalives=1' |
| `DB_HOST` | `string` | `"localhost"` | `DB_HOST` | Hostname or IP address of the database server. |
| `DB_PASSWORD` | `string` | `""` | `DB_PASSWORD` | Password for database authentication. |
| `DB_PORT` | `integer` | `5432` | `DB_PORT` | Port number for database connection. |
| `DB_SESSION_TIMEZONE_OVERRIDE` | `string` | `"UTC"` | `DB_SESSION_TIMEZONE_OVERRIDE` | PostgreSQL session timezone override injected via startup options. Default is 'UTC' for out-of-the-box consistency. Set to empty string to disable app-level timezone injection, for example when using RDS Proxy together with a database-side default timezone. |
| `DB_TYPE` | `literal['postgresql', 'mysql', 'oceanbase', 'seekdb']` | `"postgresql"` | `DB_TYPE` | Database type to use. OceanBase is MySQL-compatible. |
| `DB_USERNAME` | `string` | `"postgres"` | `DB_USERNAME` | Username for database authentication. |
| `RETRIEVAL_SERVICE_EXECUTORS` | `integer` | `10` | `RETRIEVAL_SERVICE_EXECUTORS` | Number of processes for the retrieval service, default to CPU cores. |
| `SQLALCHEMY_ECHO` | `boolean \| string` | `false` | `SQLALCHEMY_ECHO` | If True, SQLAlchemy will log all SQL statements. |
| `SQLALCHEMY_MAX_OVERFLOW` | `integer` | `10` | `SQLALCHEMY_MAX_OVERFLOW` | Maximum number of connections that can be created beyond the pool_size. |
| `SQLALCHEMY_POOL_PRE_PING` | `boolean` | `false` | `SQLALCHEMY_POOL_PRE_PING` | If True, enables connection pool pre-ping feature to check connections. |
| `SQLALCHEMY_POOL_RECYCLE` | `integer` | `3600` | `SQLALCHEMY_POOL_RECYCLE` | Number of seconds after which a connection is automatically recycled. |
| `SQLALCHEMY_POOL_SIZE` | `integer` | `30` | `SQLALCHEMY_POOL_SIZE` | Maximum number of database connections in the pool. |
| `SQLALCHEMY_POOL_TIMEOUT` | `integer` | `30` | `SQLALCHEMY_POOL_TIMEOUT` | Number of seconds to wait for a connection from the pool before raising a timeout error. |
| `SQLALCHEMY_POOL_USE_LIFO` | `boolean` | `false` | `SQLALCHEMY_POOL_USE_LIFO` | If True, SQLAlchemy will use last-in-first-out way to retrieve connections from pool. |

## `middleware.dataset-queue-monitor`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `QUEUE_MONITOR_ALERT_EMAILS` | `string \| null` | `""` | `QUEUE_MONITOR_ALERT_EMAILS` | Emails for dataset queue monitor alert, separated by commas |
| `QUEUE_MONITOR_INTERVAL` | `typing.Annotated[float, Ge(ge=0)] \| null` | `30` | `QUEUE_MONITOR_INTERVAL` | Interval for dataset queue monitor in minutes |
| `QUEUE_MONITOR_THRESHOLD` | `typing.Annotated[int, Ge(ge=0)] \| null` | `200` | `QUEUE_MONITOR_THRESHOLD` | Threshold for dataset queue monitor |

## `middleware.internal-test`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `AWS_ACCESS_KEY_ID` | `string \| null` | `""` | `AWS_ACCESS_KEY_ID` | Internal test AWS access key ID |
| `AWS_SECRET_ACCESS_KEY` | `string \| null` | `""` | `AWS_SECRET_ACCESS_KEY` | Internal test AWS secret access key |

## `middleware.keyword-store`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `KEYWORD_STORE` | `string` | `"jieba"` | `KEYWORD_STORE` | Method for keyword extraction and storage. Default is 'jieba', a Chinese text segmentation library. |

## `middleware.storage`

Applies when:
- `STORAGE_LOCAL_PATH`: `STORAGE_TYPE=local`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `STORAGE_LOCAL_PATH` | `string` | `"storage"` | `STORAGE_LOCAL_PATH` | Path for local storage when STORAGE_TYPE is set to 'local'. |
| `STORAGE_TYPE` | `literal['opendal', 's3', 'aliyun-oss', 'azure-blob', 'baidu-obs', 'clickzetta-volume', 'google-storage', 'huawei-obs', 'oci-storage', 'tencent-cos', 'volcengine-tos', 'supabase', 'local']` | `"opendal"` | `STORAGE_TYPE` | Type of storage to use. Options: 'opendal', '(deprecated) local', 's3', 'aliyun-oss', 'azure-blob', 'baidu-obs', 'clickzetta-volume', 'google-storage', 'huawei-obs', 'oci-storage', 'tencent-cos', 'volcengine-tos', 'supabase'. Default is 'opendal'. |

## `middleware.storage.aliyun-o-s-s-storage`

> Applies when: `STORAGE_TYPE=aliyun-oss`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `ALIYUN_CLOUDBOX_ID` | `string \| null` | `""` | `ALIYUN_CLOUDBOX_ID` | Cloudbox id for aliyun cloudbox service |
| `ALIYUN_OSS_ACCESS_KEY` | `string \| null` | `""` | `ALIYUN_OSS_ACCESS_KEY` | Access key ID for authenticating with Aliyun OSS |
| `ALIYUN_OSS_AUTH_VERSION` | `string \| null` | `""` | `ALIYUN_OSS_AUTH_VERSION` | Version of the authentication protocol to use with Aliyun OSS (e.g., 'v4') |
| `ALIYUN_OSS_BUCKET_NAME` | `string \| null` | `""` | `ALIYUN_OSS_BUCKET_NAME` | Name of the Aliyun OSS bucket to store and retrieve objects |
| `ALIYUN_OSS_ENDPOINT` | `string \| null` | `""` | `ALIYUN_OSS_ENDPOINT` | URL of the Aliyun OSS endpoint for your chosen region |
| `ALIYUN_OSS_PATH` | `string \| null` | `""` | `ALIYUN_OSS_PATH` | Base path within the bucket to store objects (e.g., 'my-app-data/') |
| `ALIYUN_OSS_REGION` | `string \| null` | `""` | `ALIYUN_OSS_REGION` | Aliyun OSS region where your bucket is located (e.g., 'oss-cn-hangzhou') |
| `ALIYUN_OSS_SECRET_KEY` | `string \| null` | `""` | `ALIYUN_OSS_SECRET_KEY` | Secret access key for authenticating with Aliyun OSS |

## `middleware.storage.azure-blob-storage`

> Applies when: `STORAGE_TYPE=azure-blob`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `AZURE_BLOB_ACCOUNT_KEY` | `string \| null` | `""` | `AZURE_BLOB_ACCOUNT_KEY` | Access key for authenticating with the Azure Storage account |
| `AZURE_BLOB_ACCOUNT_NAME` | `string \| null` | `""` | `AZURE_BLOB_ACCOUNT_NAME` | Name of the Azure Storage account (e.g., 'mystorageaccount') |
| `AZURE_BLOB_ACCOUNT_URL` | `string \| null` | `""` | `AZURE_BLOB_ACCOUNT_URL` | URL of the Azure Blob storage endpoint (e.g., 'https://mystorageaccount.blob.core.windows.net') |
| `AZURE_BLOB_CONTAINER_NAME` | `string \| null` | `""` | `AZURE_BLOB_CONTAINER_NAME` | Name of the Azure Blob container to store and retrieve objects |

## `middleware.storage.baidu-o-b-s-storage`

> Applies when: `STORAGE_TYPE=baidu-obs`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `BAIDU_OBS_ACCESS_KEY` | `string \| null` | `""` | `BAIDU_OBS_ACCESS_KEY` | Access Key ID for authenticating with Baidu OBS |
| `BAIDU_OBS_BUCKET_NAME` | `string \| null` | `""` | `BAIDU_OBS_BUCKET_NAME` | Name of the Baidu OBS bucket to store and retrieve objects (e.g., 'my-obs-bucket') |
| `BAIDU_OBS_ENDPOINT` | `string \| null` | `""` | `BAIDU_OBS_ENDPOINT` | URL of the Baidu OSS endpoint for your chosen region (e.g., 'https://.bj.bcebos.com') |
| `BAIDU_OBS_SECRET_KEY` | `string \| null` | `""` | `BAIDU_OBS_SECRET_KEY` | Secret Access Key for authenticating with Baidu OBS |

## `middleware.storage.click-zetta-volume-storage`

> Applies when: `STORAGE_TYPE=clickzetta-volume`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `CLICKZETTA_VOLUME_DIFY_PREFIX` | `string` | `"dify_km"` | `CLICKZETTA_VOLUME_DIFY_PREFIX` | Directory prefix for User Volume to organize Dify files |
| `CLICKZETTA_VOLUME_INSTANCE` | `string \| null` | `""` | `CLICKZETTA_VOLUME_INSTANCE` | ClickZetta instance identifier |
| `CLICKZETTA_VOLUME_NAME` | `string \| null` | `""` | `CLICKZETTA_VOLUME_NAME` | ClickZetta volume name for external volumes |
| `CLICKZETTA_VOLUME_PASSWORD` | `string \| null` | `""` | `CLICKZETTA_VOLUME_PASSWORD` | Password for ClickZetta Volume authentication |
| `CLICKZETTA_VOLUME_SCHEMA` | `string` | `"dify"` | `CLICKZETTA_VOLUME_SCHEMA` | ClickZetta schema name |
| `CLICKZETTA_VOLUME_SERVICE` | `string` | `"api.clickzetta.com"` | `CLICKZETTA_VOLUME_SERVICE` | ClickZetta service endpoint |
| `CLICKZETTA_VOLUME_TABLE_PREFIX` | `string` | `"dataset_"` | `CLICKZETTA_VOLUME_TABLE_PREFIX` | Prefix for ClickZetta volume table names |
| `CLICKZETTA_VOLUME_TYPE` | `string` | `"user"` | `CLICKZETTA_VOLUME_TYPE` | ClickZetta volume type (table\|user\|external) |
| `CLICKZETTA_VOLUME_USERNAME` | `string \| null` | `""` | `CLICKZETTA_VOLUME_USERNAME` | Username for ClickZetta Volume authentication |
| `CLICKZETTA_VOLUME_VCLUSTER` | `string` | `"default_ap"` | `CLICKZETTA_VOLUME_VCLUSTER` | ClickZetta virtual cluster name |
| `CLICKZETTA_VOLUME_WORKSPACE` | `string` | `"quick_start"` | `CLICKZETTA_VOLUME_WORKSPACE` | ClickZetta workspace name |

## `middleware.storage.google-cloud-storage`

> Applies when: `STORAGE_TYPE=google-storage`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `GOOGLE_STORAGE_BUCKET_NAME` | `string \| null` | `""` | `GOOGLE_STORAGE_BUCKET_NAME` | Name of the Google Cloud Storage bucket to store and retrieve objects (e.g., 'my-gcs-bucket') |
| `GOOGLE_STORAGE_SERVICE_ACCOUNT_JSON_BASE64` | `string \| null` | `""` | `GOOGLE_STORAGE_SERVICE_ACCOUNT_JSON_BASE64` | Base64-encoded JSON key file for Google Cloud service account authentication |

## `middleware.storage.huawei-cloud-o-b-s-storage`

> Applies when: `STORAGE_TYPE=huawei-obs`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `HUAWEI_OBS_ACCESS_KEY` | `string \| null` | `""` | `HUAWEI_OBS_ACCESS_KEY` | Access Key ID for authenticating with Huawei Cloud OBS |
| `HUAWEI_OBS_BUCKET_NAME` | `string \| null` | `""` | `HUAWEI_OBS_BUCKET_NAME` | Name of the Huawei Cloud OBS bucket to store and retrieve objects (e.g., 'my-obs-bucket') |
| `HUAWEI_OBS_PATH_STYLE` | `boolean` | `false` | `HUAWEI_OBS_PATH_STYLE` | Flag to indicate whether to use path-style URLs for OBS requests |
| `HUAWEI_OBS_SECRET_KEY` | `string \| null` | `""` | `HUAWEI_OBS_SECRET_KEY` | Secret Access Key for authenticating with Huawei Cloud OBS |
| `HUAWEI_OBS_SERVER` | `string \| null` | `""` | `HUAWEI_OBS_SERVER` | Endpoint URL for Huawei Cloud OBS (e.g., 'https://obs.cn-north-4.myhuaweicloud.com') |

## `middleware.storage.o-c-i-storage`

> Applies when: `STORAGE_TYPE=oci-storage`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `OCI_ACCESS_KEY` | `string \| null` | `""` | `OCI_ACCESS_KEY` | Access key (also known as API key) for authenticating with OCI Object Storage |
| `OCI_BUCKET_NAME` | `string \| null` | `""` | `OCI_BUCKET_NAME` | Name of the OCI Object Storage bucket to store and retrieve objects (e.g., 'my-oci-bucket') |
| `OCI_ENDPOINT` | `string \| null` | `""` | `OCI_ENDPOINT` | URL of the OCI Object Storage endpoint (e.g., 'https://objectstorage.us-phoenix-1.oraclecloud.com') |
| `OCI_REGION` | `string \| null` | `""` | `OCI_REGION` | OCI region where the bucket is located (e.g., 'us-phoenix-1') |
| `OCI_SECRET_KEY` | `string \| null` | `""` | `OCI_SECRET_KEY` | Secret key associated with the access key for authenticating with OCI Object Storage |

## `middleware.storage.open-d-a-l-storage`

> Applies when: `STORAGE_TYPE=opendal`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `OPENDAL_SCHEME` | `string` | `"fs"` | `OPENDAL_SCHEME` | OpenDAL scheme. |

## `middleware.storage.s3-storage`

> Applies when: `STORAGE_TYPE=s3`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `S3_ACCESS_KEY` | `string \| null` | `""` | `S3_ACCESS_KEY` | Access key ID for authenticating with the S3 service |
| `S3_ADDRESS_STYLE` | `literal['auto', 'virtual', 'path']` | `"auto"` | `S3_ADDRESS_STYLE` | S3 addressing style: 'auto', 'path', or 'virtual' |
| `S3_BUCKET_NAME` | `string \| null` | `""` | `S3_BUCKET_NAME` | Name of the S3 bucket to store and retrieve objects |
| `S3_ENDPOINT` | `string \| null` | `""` | `S3_ENDPOINT` | URL of the S3-compatible storage endpoint (e.g., 'https://s3.amazonaws.com') |
| `S3_REGION` | `string \| null` | `""` | `S3_REGION` | Region where the S3 bucket is located (e.g., 'us-east-1') |
| `S3_SECRET_KEY` | `string \| null` | `""` | `S3_SECRET_KEY` | Secret access key for authenticating with the S3 service |
| `S3_USE_AWS_MANAGED_IAM` | `boolean` | `false` | `S3_USE_AWS_MANAGED_IAM` | Use AWS managed IAM roles for authentication instead of access/secret keys |

## `middleware.storage.supabase-storage`

> Applies when: `STORAGE_TYPE=supabase`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `SUPABASE_API_KEY` | `string \| null` | `""` | `SUPABASE_API_KEY` | API KEY for authenticating with Supabase |
| `SUPABASE_BUCKET_NAME` | `string \| null` | `""` | `SUPABASE_BUCKET_NAME` | Name of the Supabase bucket to store and retrieve objects (e.g., 'dify-bucket') |
| `SUPABASE_URL` | `string \| null` | `""` | `SUPABASE_URL` | URL of the Supabase |

## `middleware.storage.tencent-cloud-c-o-s-storage`

> Applies when: `STORAGE_TYPE=tencent-cos`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `TENCENT_COS_BUCKET_NAME` | `string \| null` | `""` | `TENCENT_COS_BUCKET_NAME` | Name of the Tencent Cloud COS bucket to store and retrieve objects |
| `TENCENT_COS_CUSTOM_DOMAIN` | `string \| null` | `""` | `TENCENT_COS_CUSTOM_DOMAIN` | Tencent Cloud COS custom domain setting |
| `TENCENT_COS_REGION` | `string \| null` | `""` | `TENCENT_COS_REGION` | Tencent Cloud region where the COS bucket is located (e.g., 'ap-guangzhou') |
| `TENCENT_COS_SCHEME` | `string \| null` | `""` | `TENCENT_COS_SCHEME` | Protocol scheme for COS requests: 'https' (recommended) or 'http' |
| `TENCENT_COS_SECRET_ID` | `string \| null` | `""` | `TENCENT_COS_SECRET_ID` | SecretId for authenticating with Tencent Cloud COS (part of API credentials) |
| `TENCENT_COS_SECRET_KEY` | `string \| null` | `""` | `TENCENT_COS_SECRET_KEY` | SecretKey for authenticating with Tencent Cloud COS (part of API credentials) |

## `middleware.storage.volcengine-t-o-s-storage`

> Applies when: `STORAGE_TYPE=volcengine-tos`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `VOLCENGINE_TOS_ACCESS_KEY` | `string \| null` | `""` | `VOLCENGINE_TOS_ACCESS_KEY` | Access Key ID for authenticating with Volcengine TOS |
| `VOLCENGINE_TOS_BUCKET_NAME` | `string \| null` | `""` | `VOLCENGINE_TOS_BUCKET_NAME` | Name of the Volcengine TOS bucket to store and retrieve objects (e.g., 'my-tos-bucket') |
| `VOLCENGINE_TOS_ENDPOINT` | `string \| null` | `""` | `VOLCENGINE_TOS_ENDPOINT` | URL of the Volcengine TOS endpoint (e.g., 'https://tos-cn-beijing.volces.com') |
| `VOLCENGINE_TOS_REGION` | `string \| null` | `""` | `VOLCENGINE_TOS_REGION` | Volcengine region where the TOS bucket is located (e.g., 'cn-beijing') |
| `VOLCENGINE_TOS_SECRET_KEY` | `string \| null` | `""` | `VOLCENGINE_TOS_SECRET_KEY` | Secret Access Key for authenticating with Volcengine TOS |

## `middleware.vdb.alibaba-cloud-my-s-q-l`

> Applies when: `VECTOR_STORE=alibabacloud-mysql`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `ALIBABACLOUD_MYSQL_CHARSET` | `string` | `"utf8mb4"` | `ALIBABACLOUD_MYSQL_CHARSET` | Character set for AlibabaCloud MySQL connection (default is 'utf8mb4') |
| `ALIBABACLOUD_MYSQL_DATABASE` | `string` | `"dify"` | `ALIBABACLOUD_MYSQL_DATABASE` | Name of the AlibabaCloud MySQL database to connect to (default is 'dify') |
| `ALIBABACLOUD_MYSQL_DISTANCE_FUNCTION` | `string` | `"cosine"` | `ALIBABACLOUD_MYSQL_DISTANCE_FUNCTION` | Distance function used for vector similarity search in AlibabaCloud MySQL (e.g., 'cosine', 'euclidean') |
| `ALIBABACLOUD_MYSQL_HNSW_M` | `integer` | `6` | `ALIBABACLOUD_MYSQL_HNSW_M` | Maximum number of connections per layer for HNSW vector index (default is 6, range: 3-200) |
| `ALIBABACLOUD_MYSQL_HOST` | `string` | `"localhost"` | `ALIBABACLOUD_MYSQL_HOST` | Hostname or IP address of the AlibabaCloud MySQL server (e.g., 'localhost' or 'mysql.aliyun.com') |
| `ALIBABACLOUD_MYSQL_MAX_CONNECTION` | `integer` | `5` | `ALIBABACLOUD_MYSQL_MAX_CONNECTION` | Maximum number of connections in the connection pool |
| `ALIBABACLOUD_MYSQL_PASSWORD` | `string` | `""` | `ALIBABACLOUD_MYSQL_PASSWORD` | Password for authenticating with AlibabaCloud MySQL (default is an empty string) |
| `ALIBABACLOUD_MYSQL_PORT` | `integer` | `3306` | `ALIBABACLOUD_MYSQL_PORT` | Port number on which the AlibabaCloud MySQL server is listening (default is 3306) |
| `ALIBABACLOUD_MYSQL_USER` | `string` | `"root"` | `ALIBABACLOUD_MYSQL_USER` | Username for authenticating with AlibabaCloud MySQL (default is 'root') |

## `middleware.vdb.analyticdb`

> Applies when: `VECTOR_STORE=analyticdb`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `ANALYTICDB_ACCOUNT` | `string \| null` | `""` | `ANALYTICDB_ACCOUNT` | The account name used to log in to the AnalyticDB instance (usually the initial account created with the instance). |
| `ANALYTICDB_HOST` | `string \| null` | `""` | `ANALYTICDB_HOST` | The host of the AnalyticDB instance you want to connect to. |
| `ANALYTICDB_INSTANCE_ID` | `string \| null` | `""` | `ANALYTICDB_INSTANCE_ID` | The unique identifier of the AnalyticDB instance you want to connect to. |
| `ANALYTICDB_KEY_ID` | `string \| null` | `""` | `ANALYTICDB_KEY_ID` | The Access Key ID provided by Alibaba Cloud for API authentication. |
| `ANALYTICDB_KEY_SECRET` | `string \| null` | `""` | `ANALYTICDB_KEY_SECRET` | The Secret Access Key corresponding to the Access Key ID for secure API access. |
| `ANALYTICDB_MAX_CONNECTION` | `integer` | `5` | `ANALYTICDB_MAX_CONNECTION` | Max connection of the AnalyticDB database. |
| `ANALYTICDB_MIN_CONNECTION` | `integer` | `1` | `ANALYTICDB_MIN_CONNECTION` | Min connection of the AnalyticDB database. |
| `ANALYTICDB_NAMESPACE` | `string \| null` | `""` | `ANALYTICDB_NAMESPACE` | The namespace within AnalyticDB for schema isolation (if using namespace feature). |
| `ANALYTICDB_NAMESPACE_PASSWORD` | `string \| null` | `""` | `ANALYTICDB_NAMESPACE_PASSWORD` | The password for accessing the specified namespace within the AnalyticDB instance (if namespace feature is enabled). |
| `ANALYTICDB_PASSWORD` | `string \| null` | `""` | `ANALYTICDB_PASSWORD` | The password associated with the AnalyticDB account for database authentication. |
| `ANALYTICDB_PORT` | `integer` | `5432` | `ANALYTICDB_PORT` | The port of the AnalyticDB instance you want to connect to. |
| `ANALYTICDB_REGION_ID` | `string \| null` | `""` | `ANALYTICDB_REGION_ID` | The region where the AnalyticDB instance is deployed (e.g., 'cn-hangzhou', 'ap-southeast-1'). |

## `middleware.vdb.baidu-vector-d-b`

> Applies when: `VECTOR_STORE=baidu_vector`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `BAIDU_VECTOR_DB_ACCOUNT` | `string \| null` | `""` | `BAIDU_VECTOR_DB_ACCOUNT` | Account for authenticating with the Baidu Vector Database |
| `BAIDU_VECTOR_DB_API_KEY` | `string \| null` | `""` | `BAIDU_VECTOR_DB_API_KEY` | API key for authenticating with the Baidu Vector Database service |
| `BAIDU_VECTOR_DB_AUTO_BUILD_ROW_COUNT_INCREMENT` | `integer` | `500` | `BAIDU_VECTOR_DB_AUTO_BUILD_ROW_COUNT_INCREMENT` | Auto build row count increment threshold (default is 500) |
| `BAIDU_VECTOR_DB_AUTO_BUILD_ROW_COUNT_INCREMENT_RATIO` | `float` | `0.05` | `BAIDU_VECTOR_DB_AUTO_BUILD_ROW_COUNT_INCREMENT_RATIO` | Auto build row count increment ratio threshold (default is 0.05) |
| `BAIDU_VECTOR_DB_CONNECTION_TIMEOUT_MS` | `integer` | `30000` | `BAIDU_VECTOR_DB_CONNECTION_TIMEOUT_MS` | Timeout in milliseconds for Baidu Vector Database operations (default is 30000 milliseconds) |
| `BAIDU_VECTOR_DB_DATABASE` | `string \| null` | `""` | `BAIDU_VECTOR_DB_DATABASE` | Name of the specific Baidu Vector Database to connect to |
| `BAIDU_VECTOR_DB_ENDPOINT` | `string \| null` | `""` | `BAIDU_VECTOR_DB_ENDPOINT` | URL of the Baidu Vector Database service (e.g., 'http://vdb.bj.baidubce.com') |
| `BAIDU_VECTOR_DB_INVERTED_INDEX_ANALYZER` | `string` | `"DEFAULT_ANALYZER"` | `BAIDU_VECTOR_DB_INVERTED_INDEX_ANALYZER` | Analyzer type for inverted index in Baidu Vector Database (default is DEFAULT_ANALYZER) |
| `BAIDU_VECTOR_DB_INVERTED_INDEX_PARSER_MODE` | `string` | `"COARSE_MODE"` | `BAIDU_VECTOR_DB_INVERTED_INDEX_PARSER_MODE` | Parser mode for inverted index in Baidu Vector Database (default is COARSE_MODE) |
| `BAIDU_VECTOR_DB_REBUILD_INDEX_TIMEOUT_IN_SECONDS` | `integer` | `300` | `BAIDU_VECTOR_DB_REBUILD_INDEX_TIMEOUT_IN_SECONDS` | Timeout in seconds for rebuilding the index in Baidu Vector Database (default is 3600 seconds) |
| `BAIDU_VECTOR_DB_REPLICAS` | `integer` | `3` | `BAIDU_VECTOR_DB_REPLICAS` | Number of replicas for the Baidu Vector Database (default is 3) |
| `BAIDU_VECTOR_DB_SHARD` | `integer` | `1` | `BAIDU_VECTOR_DB_SHARD` | Number of shards for the Baidu Vector Database (default is 1) |

## `middleware.vdb.chroma`

> Applies when: `VECTOR_STORE=chroma`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `CHROMA_AUTH_CREDENTIALS` | `string \| null` | `""` | `CHROMA_AUTH_CREDENTIALS` | Authentication credentials for Chroma (format depends on the auth provider) |
| `CHROMA_AUTH_PROVIDER` | `string \| null` | `""` | `CHROMA_AUTH_PROVIDER` | Authentication provider for Chroma (e.g., 'basic', 'token', or a custom provider) |
| `CHROMA_DATABASE` | `string \| null` | `""` | `CHROMA_DATABASE` | Name of the Chroma database to connect to |
| `CHROMA_HOST` | `string \| null` | `""` | `CHROMA_HOST` | Hostname or IP address of the Chroma server (e.g., 'localhost' or '192.168.1.100') |
| `CHROMA_PORT` | `integer` | `8000` | `CHROMA_PORT` | Port number on which the Chroma server is listening (default is 8000) |
| `CHROMA_TENANT` | `string \| null` | `""` | `CHROMA_TENANT` | Tenant identifier for multi-tenancy support in Chroma |

## `middleware.vdb.clickzetta`

> Applies when: `VECTOR_STORE=clickzetta`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `CLICKZETTA_ANALYZER_MODE` | `string \| null` | `"smart"` | `CLICKZETTA_ANALYZER_MODE` | Analyzer mode for tokenization: max_word (fine-grained) or smart (intelligent) |
| `CLICKZETTA_ANALYZER_TYPE` | `string \| null` | `"chinese"` | `CLICKZETTA_ANALYZER_TYPE` | Analyzer type for full-text search: keyword, english, chinese, unicode |
| `CLICKZETTA_BATCH_SIZE` | `integer \| null` | `100` | `CLICKZETTA_BATCH_SIZE` | Batch size for bulk insert operations |
| `CLICKZETTA_ENABLE_INVERTED_INDEX` | `boolean \| null` | `true` | `CLICKZETTA_ENABLE_INVERTED_INDEX` | Enable inverted index for full-text search capabilities |
| `CLICKZETTA_INSTANCE` | `string \| null` | `""` | `CLICKZETTA_INSTANCE` | Clickzetta Lakehouse instance ID |
| `CLICKZETTA_PASSWORD` | `string \| null` | `""` | `CLICKZETTA_PASSWORD` | Password for authenticating with Clickzetta Lakehouse |
| `CLICKZETTA_SCHEMA` | `string \| null` | `"public"` | `CLICKZETTA_SCHEMA` | Database schema name in Clickzetta |
| `CLICKZETTA_SERVICE` | `string \| null` | `"api.clickzetta.com"` | `CLICKZETTA_SERVICE` | Clickzetta API service endpoint (e.g., 'api.clickzetta.com') |
| `CLICKZETTA_USERNAME` | `string \| null` | `""` | `CLICKZETTA_USERNAME` | Username for authenticating with Clickzetta Lakehouse |
| `CLICKZETTA_VCLUSTER` | `string \| null` | `"default_ap"` | `CLICKZETTA_VCLUSTER` | Clickzetta virtual cluster name |
| `CLICKZETTA_VECTOR_DISTANCE_FUNCTION` | `string \| null` | `"cosine_distance"` | `CLICKZETTA_VECTOR_DISTANCE_FUNCTION` | Distance function for vector similarity: l2_distance or cosine_distance |
| `CLICKZETTA_WORKSPACE` | `string \| null` | `"default"` | `CLICKZETTA_WORKSPACE` | Clickzetta workspace name |

## `middleware.vdb.couchbase`

> Applies when: `VECTOR_STORE=couchbase`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `COUCHBASE_BUCKET_NAME` | `string \| null` | `""` | `COUCHBASE_BUCKET_NAME` | COUCHBASE bucket name |
| `COUCHBASE_CONNECTION_STRING` | `string \| null` | `""` | `COUCHBASE_CONNECTION_STRING` | COUCHBASE connection string |
| `COUCHBASE_PASSWORD` | `string \| null` | `""` | `COUCHBASE_PASSWORD` | COUCHBASE password |
| `COUCHBASE_SCOPE_NAME` | `string \| null` | `""` | `COUCHBASE_SCOPE_NAME` | COUCHBASE scope name |
| `COUCHBASE_USER` | `string \| null` | `""` | `COUCHBASE_USER` | COUCHBASE user |

## `middleware.vdb.elasticsearch`

Applies when:
- `ELASTICSEARCH_HOST`, `ELASTICSEARCH_MAX_RETRIES`, `ELASTICSEARCH_PASSWORD`, `ELASTICSEARCH_PORT`, `ELASTICSEARCH_REQUEST_TIMEOUT`, `ELASTICSEARCH_RETRY_ON_TIMEOUT`, `ELASTICSEARCH_USERNAME`, `ELASTICSEARCH_VERIFY_CERTS`: `VECTOR_STORE=elasticsearch`
- `ELASTICSEARCH_API_KEY`, `ELASTICSEARCH_CA_CERTS`, `ELASTICSEARCH_CLOUD_URL`, `ELASTICSEARCH_USE_CLOUD`: `VECTOR_STORE=elasticsearch; ELASTICSEARCH_USE_CLOUD=true`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `ELASTICSEARCH_API_KEY` | `string \| null` | `""` | `ELASTICSEARCH_API_KEY` | API key for authenticating with Elastic Cloud |
| `ELASTICSEARCH_CA_CERTS` | `string \| null` | `""` | `ELASTICSEARCH_CA_CERTS` | Path to CA certificate file for SSL verification |
| `ELASTICSEARCH_CLOUD_URL` | `string \| null` | `""` | `ELASTICSEARCH_CLOUD_URL` | Full URL for Elastic Cloud deployment (e.g., 'https://example.es.region.aws.found.io:443') |
| `ELASTICSEARCH_HOST` | `string \| null` | `"127.0.0.1"` | `ELASTICSEARCH_HOST` | Hostname or IP address of the Elasticsearch server (e.g., 'localhost' or '192.168.1.100') |
| `ELASTICSEARCH_MAX_RETRIES` | `integer` | `10000` | `ELASTICSEARCH_MAX_RETRIES` | Maximum number of retry attempts (default is 10000) |
| `ELASTICSEARCH_PASSWORD` | `string \| null` | `"elastic"` | `ELASTICSEARCH_PASSWORD` | Password for authenticating with Elasticsearch (default is 'elastic') |
| `ELASTICSEARCH_PORT` | `integer` | `9200` | `ELASTICSEARCH_PORT` | Port number on which the Elasticsearch server is listening (default is 9200) |
| `ELASTICSEARCH_REQUEST_TIMEOUT` | `integer` | `100000` | `ELASTICSEARCH_REQUEST_TIMEOUT` | Request timeout in milliseconds (default is 100000) |
| `ELASTICSEARCH_RETRY_ON_TIMEOUT` | `boolean` | `true` | `ELASTICSEARCH_RETRY_ON_TIMEOUT` | Whether to retry requests on timeout (default is True) |
| `ELASTICSEARCH_USERNAME` | `string \| null` | `"elastic"` | `ELASTICSEARCH_USERNAME` | Username for authenticating with Elasticsearch (default is 'elastic') |
| `ELASTICSEARCH_USE_CLOUD` | `boolean \| null` | `false` | `ELASTICSEARCH_USE_CLOUD` | Set to True to use Elastic Cloud instead of self-hosted Elasticsearch |
| `ELASTICSEARCH_VERIFY_CERTS` | `boolean` | `false` | `ELASTICSEARCH_VERIFY_CERTS` | Whether to verify SSL certificates (default is False) |

## `middleware.vdb.hologres`

> Applies when: `VECTOR_STORE=hologres`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `HOLOGRES_ACCESS_KEY_ID` | `string \| null` | `""` | `HOLOGRES_ACCESS_KEY_ID` | Alibaba Cloud AccessKey ID, also used as the PostgreSQL username. |
| `HOLOGRES_ACCESS_KEY_SECRET` | `string \| null` | `""` | `HOLOGRES_ACCESS_KEY_SECRET` | Alibaba Cloud AccessKey Secret, also used as the PostgreSQL password. |
| `HOLOGRES_BASE_QUANTIZATION_TYPE` | `string` | `"rabitq"` | `HOLOGRES_BASE_QUANTIZATION_TYPE` | Base quantization type for vector index (e.g., 'rabitq', 'sq8', 'fp16', 'fp32'). |
| `HOLOGRES_DATABASE` | `string \| null` | `""` | `HOLOGRES_DATABASE` | Name of the Hologres database to connect to. |
| `HOLOGRES_DISTANCE_METHOD` | `string` | `"Cosine"` | `HOLOGRES_DISTANCE_METHOD` | Distance method for vector index (e.g., 'Cosine', 'Euclidean', 'InnerProduct'). |
| `HOLOGRES_EF_CONSTRUCTION` | `integer` | `400` | `HOLOGRES_EF_CONSTRUCTION` | ef_construction parameter for HNSW vector index. |
| `HOLOGRES_HOST` | `string \| null` | `""` | `HOLOGRES_HOST` | Hostname or IP address of the Hologres instance. |
| `HOLOGRES_MAX_DEGREE` | `integer` | `64` | `HOLOGRES_MAX_DEGREE` | Max degree (M) parameter for HNSW vector index. |
| `HOLOGRES_PORT` | `integer` | `80` | `HOLOGRES_PORT` | Port number for connecting to the Hologres instance. |
| `HOLOGRES_SCHEMA` | `string` | `"public"` | `HOLOGRES_SCHEMA` | Schema name in the Hologres database. |
| `HOLOGRES_TOKENIZER` | `string` | `"jieba"` | `HOLOGRES_TOKENIZER` | Tokenizer for full-text search index (e.g., 'jieba', 'ik', 'standard', 'simple'). |

## `middleware.vdb.huawei-cloud`

> Applies when: `VECTOR_STORE=huawei-cloud`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `HUAWEI_CLOUD_HOSTS` | `string \| null` | `""` | `HUAWEI_CLOUD_HOSTS` | Hostname or IP address of the Huawei cloud search service instance |
| `HUAWEI_CLOUD_PASSWORD` | `string \| null` | `""` | `HUAWEI_CLOUD_PASSWORD` | Password for authenticating with Huawei cloud search service |
| `HUAWEI_CLOUD_USER` | `string \| null` | `""` | `HUAWEI_CLOUD_USER` | Username for authenticating with Huawei cloud search service |

## `middleware.vdb.iris-vector`

> Applies when: `VECTOR_STORE=iris`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `IRIS_CONNECTION_URL` | `string \| null` | `""` | `IRIS_CONNECTION_URL` | Full connection URL for IRIS (overrides individual fields if provided). |
| `IRIS_DATABASE` | `string \| null` | `"USER"` | `IRIS_DATABASE` | Database namespace for IRIS connection. |
| `IRIS_HOST` | `string \| null` | `"localhost"` | `IRIS_HOST` | Hostname or IP address of the IRIS server. |
| `IRIS_MAX_CONNECTION` | `integer` | `3` | `IRIS_MAX_CONNECTION` | Maximum number of connections in the pool. |
| `IRIS_MIN_CONNECTION` | `integer` | `1` | `IRIS_MIN_CONNECTION` | Minimum number of connections in the pool. |
| `IRIS_PASSWORD` | `string \| null` | `"Dify@1234"` | `IRIS_PASSWORD` | Password for IRIS authentication. |
| `IRIS_SCHEMA` | `string \| null` | `"dify"` | `IRIS_SCHEMA` | Schema name for IRIS tables. |
| `IRIS_SUPER_SERVER_PORT` | `typing.Annotated[int, Gt(gt=0)] \| null` | `1972` | `IRIS_SUPER_SERVER_PORT` | Port number for IRIS connection. |
| `IRIS_TEXT_INDEX` | `boolean` | `true` | `IRIS_TEXT_INDEX` | Enable full-text search index using %iFind. Index. Basic. |
| `IRIS_TEXT_INDEX_LANGUAGE` | `string` | `"en"` | `IRIS_TEXT_INDEX_LANGUAGE` | Language for full-text search index (e.g., 'en', 'ja', 'zh', 'de'). |
| `IRIS_USER` | `string \| null` | `"_SYSTEM"` | `IRIS_USER` | Username for IRIS authentication. |

## `middleware.vdb.lindorm`

> Applies when: `VECTOR_STORE=lindorm`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `LINDORM_DISTANCE_TYPE` | `string \| null` | `"l2"` | `LINDORM_DISTANCE_TYPE` | Vector Distance Type, support l2, cosinesimil, innerproduct |
| `LINDORM_INDEX_TYPE` | `string \| null` | `"hnsw"` | `LINDORM_INDEX_TYPE` | Lindorm Vector Index Type, hnsw or flat is available in dify |
| `LINDORM_PASSWORD` | `string \| null` | `""` | `LINDORM_PASSWORD` | Lindorm password |
| `LINDORM_QUERY_TIMEOUT` | `float \| null` | `2.0` | `LINDORM_QUERY_TIMEOUT` | The lindorm search request timeout (s) |
| `LINDORM_URL` | `string \| null` | `""` | `LINDORM_URL` | Lindorm url |
| `LINDORM_USERNAME` | `string \| null` | `""` | `LINDORM_USERNAME` | Lindorm user |
| `LINDORM_USING_UGC` | `boolean \| null` | `true` | `LINDORM_USING_UGC` | Using UGC index will store indexes with the same IndexType/Dimension in a single big index. |

## `middleware.vdb.matrixone`

> Applies when: `VECTOR_STORE=matrixone`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `MATRIXONE_DATABASE` | `string` | `"dify"` | `MATRIXONE_DATABASE` | Name of the Matrixone database to connect to |
| `MATRIXONE_HOST` | `string` | `"localhost"` | `MATRIXONE_HOST` | Host address of the Matrixone server |
| `MATRIXONE_METRIC` | `string` | `"l2"` | `MATRIXONE_METRIC` | Distance metric type for vector similarity search (cosine or l2) |
| `MATRIXONE_PASSWORD` | `string` | `"111"` | `MATRIXONE_PASSWORD` | Password for authenticating with Matrixone |
| `MATRIXONE_PORT` | `integer` | `6001` | `MATRIXONE_PORT` | Port number of the Matrixone server |
| `MATRIXONE_USER` | `string` | `"dump"` | `MATRIXONE_USER` | Username for authenticating with Matrixone |

## `middleware.vdb.milvus`

> Applies when: `VECTOR_STORE=milvus`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `MILVUS_ANALYZER_PARAMS` | `string \| null` | `""` | `MILVUS_ANALYZER_PARAMS` | Milvus text analyzer parameters, e.g., {"type": "chinese"} for Chinese segmentation support. |
| `MILVUS_DATABASE` | `string` | `"default"` | `MILVUS_DATABASE` | Name of the Milvus database to connect to (default is 'default') |
| `MILVUS_ENABLE_HYBRID_SEARCH` | `boolean` | `true` | `MILVUS_ENABLE_HYBRID_SEARCH` | Enable hybrid search features (requires Milvus >= 2.5.0). Set to false for compatibility with older versions |
| `MILVUS_PASSWORD` | `string \| null` | `""` | `MILVUS_PASSWORD` | Password for authenticating with Milvus, if username/password authentication is enabled |
| `MILVUS_TOKEN` | `string \| null` | `""` | `MILVUS_TOKEN` | Authentication token for Milvus, if token-based authentication is enabled |
| `MILVUS_URI` | `string \| null` | `"http://127.0.0.1:19530"` | `MILVUS_URI` | URI for connecting to the Milvus server (e.g., 'http://localhost:19530' or 'https://milvus-instance.example.com:19530') |
| `MILVUS_USER` | `string \| null` | `""` | `MILVUS_USER` | Username for authenticating with Milvus, if username/password authentication is enabled |

## `middleware.vdb.my-scale`

> Applies when: `VECTOR_STORE=myscale`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `MYSCALE_DATABASE` | `string` | `"default"` | `MYSCALE_DATABASE` | Name of the MyScale database to connect to (default is 'default') |
| `MYSCALE_FTS_PARAMS` | `string` | `""` | `MYSCALE_FTS_PARAMS` | Additional parameters for MyScale Full Text Search index) |
| `MYSCALE_HOST` | `string` | `"localhost"` | `MYSCALE_HOST` | Hostname or IP address of the MyScale server (e.g., 'localhost' or 'myscale.example.com') |
| `MYSCALE_PASSWORD` | `string` | `""` | `MYSCALE_PASSWORD` | Password for authenticating with MyScale (default is an empty string) |
| `MYSCALE_PORT` | `integer` | `8123` | `MYSCALE_PORT` | Port number on which the MyScale server is listening (default is 8123) |
| `MYSCALE_USER` | `string` | `"default"` | `MYSCALE_USER` | Username for authenticating with MyScale (default is 'default') |

## `middleware.vdb.ocean-base-vector`

> Applies when: `VECTOR_STORE=oceanbase`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `OCEANBASE_ENABLE_HYBRID_SEARCH` | `boolean` | `false` | `OCEANBASE_ENABLE_HYBRID_SEARCH` | Enable hybrid search features (requires OceanBase >= 4.3.5.1). Set to false for compatibility with older versions |
| `OCEANBASE_FULLTEXT_PARSER` | `string \| null` | `"ik"` | `OCEANBASE_FULLTEXT_PARSER` | Fulltext parser to use for text indexing. Built-in options: 'ngram' (N-gram tokenizer for English/numbers), 'beng' (Basic English tokenizer), 'space' (Space-based tokenizer), 'ngram2' (Improved N-gram tokenizer), 'ik' (Chinese tokenizer). External plugins (require installation): 'japanese_ftparser' (Japanese tokenizer), 'thai_ftparser' (Thai tokenizer). Default is 'ik' |
| `OCEANBASE_HNSW_EF_CONSTRUCTION` | `integer` | `256` | `OCEANBASE_HNSW_EF_CONSTRUCTION` | HNSW efConstruction parameter (index build-time search width) |
| `OCEANBASE_HNSW_EF_SEARCH` | `integer` | `-1` | `OCEANBASE_HNSW_EF_SEARCH` | HNSW efSearch parameter (query-time search width, -1 uses server default) |
| `OCEANBASE_HNSW_M` | `integer` | `16` | `OCEANBASE_HNSW_M` | HNSW M parameter (max number of connections per node) |
| `OCEANBASE_HNSW_REFRESH_THRESHOLD` | `integer` | `1000` | `OCEANBASE_HNSW_REFRESH_THRESHOLD` | Minimum number of inserted documents to trigger an automatic HNSW index refresh (0 to disable) |
| `OCEANBASE_VECTOR_BATCH_SIZE` | `integer` | `100` | `OCEANBASE_VECTOR_BATCH_SIZE` | Number of documents to insert per batch |
| `OCEANBASE_VECTOR_DATABASE` | `string \| null` | `""` | `OCEANBASE_VECTOR_DATABASE` | Name of the OceanBase Vector database to connect to |
| `OCEANBASE_VECTOR_HOST` | `string \| null` | `""` | `OCEANBASE_VECTOR_HOST` | Hostname or IP address of the OceanBase Vector server (e.g. 'localhost') |
| `OCEANBASE_VECTOR_MAX_OVERFLOW` | `integer` | `10` | `OCEANBASE_VECTOR_MAX_OVERFLOW` | SQLAlchemy connection pool max overflow connections |
| `OCEANBASE_VECTOR_METRIC_TYPE` | `literal['l2', 'cosine', 'inner_product']` | `"l2"` | `OCEANBASE_VECTOR_METRIC_TYPE` | Distance metric type for vector index: l2, cosine, or inner_product |
| `OCEANBASE_VECTOR_PASSWORD` | `string \| null` | `""` | `OCEANBASE_VECTOR_PASSWORD` | Password for authenticating with the OceanBase Vector database |
| `OCEANBASE_VECTOR_POOL_SIZE` | `integer` | `5` | `OCEANBASE_VECTOR_POOL_SIZE` | SQLAlchemy connection pool size |
| `OCEANBASE_VECTOR_PORT` | `typing.Annotated[int, Gt(gt=0)] \| null` | `2881` | `OCEANBASE_VECTOR_PORT` | Port number on which the OceanBase Vector server is listening (default is 2881) |
| `OCEANBASE_VECTOR_USER` | `string \| null` | `""` | `OCEANBASE_VECTOR_USER` | Username for authenticating with the OceanBase Vector database |

## `middleware.vdb.open-gauss`

> Applies when: `VECTOR_STORE=opengauss`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `OPENGAUSS_DATABASE` | `string \| null` | `""` | `OPENGAUSS_DATABASE` | Name of the OpenGauss database to connect to |
| `OPENGAUSS_ENABLE_PQ` | `boolean` | `false` | `OPENGAUSS_ENABLE_PQ` | Enable openGauss PQ acceleration feature |
| `OPENGAUSS_HOST` | `string \| null` | `""` | `OPENGAUSS_HOST` | Hostname or IP address of the OpenGauss server (e.g., 'localhost') |
| `OPENGAUSS_MAX_CONNECTION` | `integer` | `5` | `OPENGAUSS_MAX_CONNECTION` | Max connection of the OpenGauss database |
| `OPENGAUSS_MIN_CONNECTION` | `integer` | `1` | `OPENGAUSS_MIN_CONNECTION` | Min connection of the OpenGauss database |
| `OPENGAUSS_PASSWORD` | `string \| null` | `""` | `OPENGAUSS_PASSWORD` | Password for authenticating with the OpenGauss database |
| `OPENGAUSS_PORT` | `integer` | `6600` | `OPENGAUSS_PORT` | Port number on which the OpenGauss server is listening (default is 6600) |
| `OPENGAUSS_USER` | `string \| null` | `""` | `OPENGAUSS_USER` | Username for authenticating with the OpenGauss database |

## `middleware.vdb.open-search`

> Applies when: `VECTOR_STORE=opensearch`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `OPENSEARCH_AUTH_METHOD` | `enum` | `"basic"` | `OPENSEARCH_AUTH_METHOD` | Authentication method for OpenSearch connection (default is 'basic') |
| `OPENSEARCH_AWS_REGION` | `string \| null` | `""` | `OPENSEARCH_AWS_REGION` | AWS region for OpenSearch (e.g. 'us-west-2') |
| `OPENSEARCH_AWS_SERVICE` | `literal['es', 'aoss'] \| null` | `""` | `OPENSEARCH_AWS_SERVICE` | AWS service for OpenSearch (e.g. 'aoss' for OpenSearch Serverless) |
| `OPENSEARCH_HOST` | `string \| null` | `""` | `OPENSEARCH_HOST` | Hostname or IP address of the OpenSearch server (e.g., 'localhost' or 'opensearch.example.com') |
| `OPENSEARCH_PASSWORD` | `string \| null` | `""` | `OPENSEARCH_PASSWORD` | Password for authenticating with OpenSearch |
| `OPENSEARCH_PORT` | `integer` | `9200` | `OPENSEARCH_PORT` | Port number on which the OpenSearch server is listening (default is 9200) |
| `OPENSEARCH_SECURE` | `boolean` | `false` | `OPENSEARCH_SECURE` | Whether to use SSL/TLS encrypted connection for OpenSearch (True for HTTPS, False for HTTP) |
| `OPENSEARCH_USER` | `string \| null` | `""` | `OPENSEARCH_USER` | Username for authenticating with OpenSearch |
| `OPENSEARCH_VERIFY_CERTS` | `boolean` | `true` | `OPENSEARCH_VERIFY_CERTS` | Whether to verify SSL certificates for HTTPS connections (recommended to set True in production) |

## `middleware.vdb.oracle`

> Applies when: `VECTOR_STORE=oracle`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `ORACLE_CONFIG_DIR` | `string \| null` | `""` | `ORACLE_CONFIG_DIR` | Directory containing the tnsnames.ora configuration file. Only used in thin mode connection |
| `ORACLE_DSN` | `string \| null` | `""` | `ORACLE_DSN` | Oracle database connection string. For traditional database, use format 'host:port/service_name'. For autonomous database, use the service name from tnsnames.ora in the wallet |
| `ORACLE_IS_AUTONOMOUS` | `boolean` | `false` | `ORACLE_IS_AUTONOMOUS` | Flag indicating whether connecting to Oracle Autonomous Database |
| `ORACLE_PASSWORD` | `string \| null` | `""` | `ORACLE_PASSWORD` | Password for authenticating with the Oracle database |
| `ORACLE_USER` | `string \| null` | `""` | `ORACLE_USER` | Username for authenticating with the Oracle database |
| `ORACLE_WALLET_LOCATION` | `string \| null` | `""` | `ORACLE_WALLET_LOCATION` | Oracle wallet directory path containing the wallet files for secure connection |
| `ORACLE_WALLET_PASSWORD` | `string \| null` | `""` | `ORACLE_WALLET_PASSWORD` | Password to decrypt the Oracle wallet, if it is encrypted |

## `middleware.vdb.p-g-vecto-r-s`

> Applies when: `VECTOR_STORE=pgvectors`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `PGVECTO_RS_DATABASE` | `string \| null` | `""` | `PGVECTO_RS_DATABASE` | Name of the PostgreSQL database with PGVecto. RS extension to connect to |
| `PGVECTO_RS_HOST` | `string \| null` | `""` | `PGVECTO_RS_HOST` | Hostname or IP address of the PostgreSQL server with PGVecto. RS extension (e.g., 'localhost') |
| `PGVECTO_RS_PASSWORD` | `string \| null` | `""` | `PGVECTO_RS_PASSWORD` | Password for authenticating with the PostgreSQL database using PGVecto. RS |
| `PGVECTO_RS_PORT` | `integer` | `5431` | `PGVECTO_RS_PORT` | Port number on which the PostgreSQL server with PGVecto. RS is listening (default is 5431) |
| `PGVECTO_RS_USER` | `string \| null` | `""` | `PGVECTO_RS_USER` | Username for authenticating with the PostgreSQL database using PGVecto. RS |

## `middleware.vdb.p-g-vector`

> Applies when: `VECTOR_STORE=pgvector`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `PGVECTOR_DATABASE` | `string \| null` | `""` | `PGVECTOR_DATABASE` | Name of the PostgreSQL database to connect to |
| `PGVECTOR_HOST` | `string \| null` | `""` | `PGVECTOR_HOST` | Hostname or IP address of the PostgreSQL server with PGVector extension (e.g., 'localhost') |
| `PGVECTOR_MAX_CONNECTION` | `integer` | `5` | `PGVECTOR_MAX_CONNECTION` | Max connection of the PostgreSQL database |
| `PGVECTOR_MIN_CONNECTION` | `integer` | `1` | `PGVECTOR_MIN_CONNECTION` | Min connection of the PostgreSQL database |
| `PGVECTOR_PASSWORD` | `string \| null` | `""` | `PGVECTOR_PASSWORD` | Password for authenticating with the PostgreSQL database |
| `PGVECTOR_PG_BIGM` | `boolean` | `false` | `PGVECTOR_PG_BIGM` | Whether to use pg_bigm module for full text search |
| `PGVECTOR_PORT` | `integer` | `5433` | `PGVECTOR_PORT` | Port number on which the PostgreSQL server is listening (default is 5433) |
| `PGVECTOR_USER` | `string \| null` | `""` | `PGVECTOR_USER` | Username for authenticating with the PostgreSQL database |

## `middleware.vdb.qdrant`

> Applies when: `VECTOR_STORE=qdrant`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `QDRANT_API_KEY` | `string \| null` | `""` | `QDRANT_API_KEY` | API key for authenticating with the Qdrant server |
| `QDRANT_CLIENT_TIMEOUT` | `integer` | `20` | `QDRANT_CLIENT_TIMEOUT` | Timeout in seconds for Qdrant client operations (default is 20 seconds) |
| `QDRANT_GRPC_ENABLED` | `boolean` | `false` | `QDRANT_GRPC_ENABLED` | Whether to enable gRPC support for Qdrant connection (True for gRPC, False for HTTP) |
| `QDRANT_GRPC_PORT` | `integer` | `6334` | `QDRANT_GRPC_PORT` | Port number for gRPC connection to Qdrant server (default is 6334) |
| `QDRANT_REPLICATION_FACTOR` | `integer` | `1` | `QDRANT_REPLICATION_FACTOR` | Replication factor for Qdrant collections (default is 1) |
| `QDRANT_URL` | `string \| null` | `""` | `QDRANT_URL` | URL of the Qdrant server (e.g., 'http://localhost:6333' or 'https://qdrant.example.com') |

## `middleware.vdb.relyt`

> Applies when: `VECTOR_STORE=relyt`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `RELYT_DATABASE` | `string \| null` | `"default"` | `RELYT_DATABASE` | Name of the Relyt database to connect to (default is 'default') |
| `RELYT_HOST` | `string \| null` | `""` | `RELYT_HOST` | Hostname or IP address of the Relyt server (e.g., 'localhost' or 'relyt.example.com') |
| `RELYT_PASSWORD` | `string \| null` | `""` | `RELYT_PASSWORD` | Password for authenticating with the Relyt database |
| `RELYT_PORT` | `integer` | `9200` | `RELYT_PORT` | Port number on which the Relyt server is listening (default is 9200) |
| `RELYT_USER` | `string \| null` | `""` | `RELYT_USER` | Username for authenticating with the Relyt database |

## `middleware.vdb.table-store`

> Applies when: `VECTOR_STORE=tablestore`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `TABLESTORE_ACCESS_KEY_ID` | `string \| null` | `""` | `TABLESTORE_ACCESS_KEY_ID` | AccessKey id for the instance name |
| `TABLESTORE_ACCESS_KEY_SECRET` | `string \| null` | `""` | `TABLESTORE_ACCESS_KEY_SECRET` | AccessKey secret for the instance name |
| `TABLESTORE_ENDPOINT` | `string \| null` | `""` | `TABLESTORE_ENDPOINT` | Endpoint address of the TableStore server (e.g. 'https://instance-name.cn-hangzhou.ots.aliyuncs.com') |
| `TABLESTORE_INSTANCE_NAME` | `string \| null` | `""` | `TABLESTORE_INSTANCE_NAME` | Instance name to access TableStore server (eg. 'instance-name') |
| `TABLESTORE_NORMALIZE_FULLTEXT_BM25_SCORE` | `boolean` | `false` | `TABLESTORE_NORMALIZE_FULLTEXT_BM25_SCORE` | Whether to normalize full-text search scores to [0, 1] |

## `middleware.vdb.tencent-vector-d-b`

> Applies when: `VECTOR_STORE=tencent`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `TENCENT_VECTOR_DB_API_KEY` | `string \| null` | `""` | `TENCENT_VECTOR_DB_API_KEY` | API key for authenticating with the Tencent Vector Database service |
| `TENCENT_VECTOR_DB_DATABASE` | `string \| null` | `""` | `TENCENT_VECTOR_DB_DATABASE` | Name of the specific Tencent Vector Database to connect to |
| `TENCENT_VECTOR_DB_ENABLE_HYBRID_SEARCH` | `boolean` | `false` | `TENCENT_VECTOR_DB_ENABLE_HYBRID_SEARCH` | Enable hybrid search features |
| `TENCENT_VECTOR_DB_PASSWORD` | `string \| null` | `""` | `TENCENT_VECTOR_DB_PASSWORD` | Password for authenticating with the Tencent Vector Database (if required) |
| `TENCENT_VECTOR_DB_REPLICAS` | `integer` | `2` | `TENCENT_VECTOR_DB_REPLICAS` | Number of replicas for the Tencent Vector Database (default is 2) |
| `TENCENT_VECTOR_DB_SHARD` | `integer` | `1` | `TENCENT_VECTOR_DB_SHARD` | Number of shards for the Tencent Vector Database (default is 1) |
| `TENCENT_VECTOR_DB_TIMEOUT` | `integer` | `30` | `TENCENT_VECTOR_DB_TIMEOUT` | Timeout in seconds for Tencent Vector Database operations (default is 30 seconds) |
| `TENCENT_VECTOR_DB_URL` | `string \| null` | `""` | `TENCENT_VECTOR_DB_URL` | URL of the Tencent Vector Database service (e.g., 'https://vectordb.tencentcloudapi.com') |
| `TENCENT_VECTOR_DB_USERNAME` | `string \| null` | `""` | `TENCENT_VECTOR_DB_USERNAME` | Username for authenticating with the Tencent Vector Database (if required) |

## `middleware.vdb.ti-d-b-vector`

> Applies when: `VECTOR_STORE=tidb_vector`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `TIDB_VECTOR_DATABASE` | `string \| null` | `""` | `TIDB_VECTOR_DATABASE` | Name of the TiDB Vector database to connect to |
| `TIDB_VECTOR_HOST` | `string \| null` | `""` | `TIDB_VECTOR_HOST` | Hostname or IP address of the TiDB Vector server (e.g., 'localhost' or 'tidb.example.com') |
| `TIDB_VECTOR_PASSWORD` | `string \| null` | `""` | `TIDB_VECTOR_PASSWORD` | Password for authenticating with the TiDB Vector database |
| `TIDB_VECTOR_PORT` | `typing.Annotated[int, Gt(gt=0)] \| null` | `4000` | `TIDB_VECTOR_PORT` | Port number on which the TiDB Vector server is listening (default is 4000) |
| `TIDB_VECTOR_USER` | `string \| null` | `""` | `TIDB_VECTOR_USER` | Username for authenticating with the TiDB Vector database |

## `middleware.vdb.tidb-on-qdrant`

> Applies when: `VECTOR_STORE=tidb_on_qdrant`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `TIDB_API_URL` | `string \| null` | `""` | `TIDB_API_URL` | Tidb API url |
| `TIDB_IAM_API_URL` | `string \| null` | `""` | `TIDB_IAM_API_URL` | Tidb IAM API url |
| `TIDB_ON_QDRANT_API_KEY` | `string \| null` | `""` | `TIDB_ON_QDRANT_API_KEY` | Tidb on Qdrant api key |
| `TIDB_ON_QDRANT_CLIENT_TIMEOUT` | `integer` | `20` | `TIDB_ON_QDRANT_CLIENT_TIMEOUT` | Tidb on Qdrant client timeout in seconds |
| `TIDB_ON_QDRANT_GRPC_ENABLED` | `boolean` | `false` | `TIDB_ON_QDRANT_GRPC_ENABLED` | whether enable grpc support for Tidb on Qdrant connection |
| `TIDB_ON_QDRANT_GRPC_PORT` | `integer` | `6334` | `TIDB_ON_QDRANT_GRPC_PORT` | Tidb on Qdrant grpc port |
| `TIDB_ON_QDRANT_URL` | `string \| null` | `""` | `TIDB_ON_QDRANT_URL` | Tidb on Qdrant url |
| `TIDB_PRIVATE_KEY` | `string \| null` | `""` | `TIDB_PRIVATE_KEY` | Tidb account private key |
| `TIDB_PROJECT_ID` | `string \| null` | `""` | `TIDB_PROJECT_ID` | Tidb project id |
| `TIDB_PUBLIC_KEY` | `string \| null` | `""` | `TIDB_PUBLIC_KEY` | Tidb account public key |
| `TIDB_REGION` | `string \| null` | `"regions/aws-us-east-1"` | `TIDB_REGION` | Tidb serverless region |
| `TIDB_SPEND_LIMIT` | `integer \| null` | `100` | `TIDB_SPEND_LIMIT` | Tidb spend limit |

## `middleware.vdb.upstash`

> Applies when: `VECTOR_STORE=upstash`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `UPSTASH_VECTOR_TOKEN` | `string \| null` | `""` | `UPSTASH_VECTOR_TOKEN` | Token for authenticating with the upstash server |
| `UPSTASH_VECTOR_URL` | `string \| null` | `""` | `UPSTASH_VECTOR_URL` | URL of the upstash server (e.g., 'https://vector.upstash.io') |

## `middleware.vdb.vastbase-vector`

> Applies when: `VECTOR_STORE=vastbase`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `VASTBASE_DATABASE` | `string \| null` | `""` | `VASTBASE_DATABASE` | Name of the Vastbase database to connect to |
| `VASTBASE_HOST` | `string \| null` | `""` | `VASTBASE_HOST` | Hostname or IP address of the Vastbase server with Vector extension (e.g., 'localhost') |
| `VASTBASE_MAX_CONNECTION` | `integer` | `5` | `VASTBASE_MAX_CONNECTION` | Max connection of the Vastbase database |
| `VASTBASE_MIN_CONNECTION` | `integer` | `1` | `VASTBASE_MIN_CONNECTION` | Min connection of the Vastbase database |
| `VASTBASE_PASSWORD` | `string \| null` | `""` | `VASTBASE_PASSWORD` | Password for authenticating with the Vastbase database |
| `VASTBASE_PORT` | `integer` | `5432` | `VASTBASE_PORT` | Port number on which the Vastbase server is listening (default is 5432) |
| `VASTBASE_USER` | `string \| null` | `""` | `VASTBASE_USER` | Username for authenticating with the Vastbase database |

## `middleware.vdb.viking-d-b`

> Applies when: `VECTOR_STORE=vikingdb`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `VIKINGDB_ACCESS_KEY` | `string \| null` | `""` | `VIKINGDB_ACCESS_KEY` | The Access Key provided by Volcengine VikingDB for API authentication. Refer to the following documentation for details on obtaining credentials: https://www.volcengine.com/docs/6291/65568 |
| `VIKINGDB_CONNECTION_TIMEOUT` | `integer` | `30` | `VIKINGDB_CONNECTION_TIMEOUT` | The connection timeout of the Volcengine VikingDB service. |
| `VIKINGDB_HOST` | `string` | `"api-vikingdb.mlp.cn-shanghai.volces.com"` | `VIKINGDB_HOST` | The host of the Volcengine VikingDB service.(e.g., 'api-vikingdb.volces.com', 'api-vikingdb.mlp.cn-shanghai.volces.com') |
| `VIKINGDB_REGION` | `string` | `"cn-shanghai"` | `VIKINGDB_REGION` | The region of the Volcengine VikingDB service.(e.g., 'cn-shanghai', 'cn-beijing'). |
| `VIKINGDB_SCHEME` | `string` | `"http"` | `VIKINGDB_SCHEME` | The scheme of the Volcengine VikingDB service.(e.g., 'http', 'https'). |
| `VIKINGDB_SECRET_KEY` | `string \| null` | `""` | `VIKINGDB_SECRET_KEY` | The Secret Key provided by Volcengine VikingDB for API authentication. |
| `VIKINGDB_SOCKET_TIMEOUT` | `integer` | `30` | `VIKINGDB_SOCKET_TIMEOUT` | The socket timeout of the Volcengine VikingDB service. |

## `middleware.vdb.weaviate`

> Applies when: `VECTOR_STORE=weaviate`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `WEAVIATE_API_KEY` | `string \| null` | `""` | `WEAVIATE_API_KEY` | API key for authenticating with the Weaviate server |
| `WEAVIATE_BATCH_SIZE` | `integer` | `100` | `WEAVIATE_BATCH_SIZE` | Number of objects to be processed in a single batch operation (default is 100) |
| `WEAVIATE_ENDPOINT` | `string \| null` | `""` | `WEAVIATE_ENDPOINT` | URL of the Weaviate server (e.g., 'http://localhost:8080' or 'https://weaviate.example.com') |
| `WEAVIATE_GRPC_ENDPOINT` | `string \| null` | `""` | `WEAVIATE_GRPC_ENDPOINT` | URL of the Weaviate gRPC server (e.g., 'grpc://localhost:50051' or 'grpcs://weaviate.example.com:443') |
| `WEAVIATE_TOKENIZATION` | `string \| null` | `"word"` | `WEAVIATE_TOKENIZATION` | Tokenization for Weaviate (default is word) |

## `middleware.vector-store`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `VECTOR_INDEX_NAME_PREFIX` | `string \| null` | `"Vector_index"` | `VECTOR_INDEX_NAME_PREFIX` | Prefix used to create collection name in vector database |
| `VECTOR_STORE` | `string \| null` | `""` | `VECTOR_STORE` | Type of vector store to use for efficient similarity search. Set to None if not using a vector store. |
| `VECTOR_STORE_WHITELIST_ENABLE` | `boolean \| null` | `false` | `VECTOR_STORE_WHITELIST_ENABLE` | Enable whitelist for vector store. |

## `observability.otel.o-tel`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `ENABLE_OTEL` | `boolean` | `false` | `ENABLE_OTEL` | Whether to enable OpenTelemetry |
| `OTEL_BATCH_EXPORT_SCHEDULE_DELAY` | `integer` | `5000` | `OTEL_BATCH_EXPORT_SCHEDULE_DELAY` | Batch export schedule delay in milliseconds |
| `OTEL_BATCH_EXPORT_TIMEOUT` | `integer` | `10000` | `OTEL_BATCH_EXPORT_TIMEOUT` | Batch export timeout in milliseconds |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `string` | `"http"` | `OTEL_EXPORTER_OTLP_PROTOCOL` | OTLP exporter protocol ('grpc' or 'http') |
| `OTEL_EXPORTER_TYPE` | `string` | `"otlp"` | `OTEL_EXPORTER_TYPE` | OTEL exporter type |
| `OTEL_MAX_EXPORT_BATCH_SIZE` | `integer` | `512` | `OTEL_MAX_EXPORT_BATCH_SIZE` | Maximum export batch size |
| `OTEL_MAX_QUEUE_SIZE` | `integer` | `2048` | `OTEL_MAX_QUEUE_SIZE` | Maximum queue size for the batch span processor |
| `OTEL_METRIC_EXPORT_INTERVAL` | `integer` | `60000` | `OTEL_METRIC_EXPORT_INTERVAL` | Metric export interval in milliseconds |
| `OTEL_METRIC_EXPORT_TIMEOUT` | `integer` | `30000` | `OTEL_METRIC_EXPORT_TIMEOUT` | Metric export timeout in milliseconds |
| `OTEL_SAMPLING_RATE` | `float` | `0.1` | `OTEL_SAMPLING_RATE` | Sampling rate for traces (0.0 to 1.0) |
| `OTLP_API_KEY` | `string` | `""` | `OTLP_API_KEY` | OTLP API key |
| `OTLP_BASE_ENDPOINT` | `string` | `"http://localhost:4318"` | `OTLP_BASE_ENDPOINT` | OTLP base endpoint |
| `OTLP_METRIC_ENDPOINT` | `string` | `""` | `OTLP_METRIC_ENDPOINT` | OTLP metric endpoint |
| `OTLP_TRACE_ENDPOINT` | `string` | `""` | `OTLP_TRACE_ENDPOINT` | OTLP trace endpoint |

## `packaging.packaging-info`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `COMMIT_SHA` | `string` | `""` | `COMMIT_SHA` | SHA-1 checksum of the git commit used to build the app |

## `remote_settings_sources.apollo.apollo-settings-source-info`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `APOLLO_APP_ID` | `string \| null` | `""` | `APOLLO_APP_ID` | apollo app_id |
| `APOLLO_CLUSTER` | `string \| null` | `""` | `APOLLO_CLUSTER` | apollo cluster |
| `APOLLO_CONFIG_URL` | `string \| null` | `""` | `APOLLO_CONFIG_URL` | apollo config url |
| `APOLLO_NAMESPACE` | `string \| null` | `""` | `APOLLO_NAMESPACE` | apollo namespace |

## `remote_settings_sources.remote-settings-source`

| Name | Type | Default | Accepted Env Names | Description |
| --- | --- | --- | --- | --- |
| `REMOTE_SETTINGS_SOURCE_NAME` | `enum \| string` | `""` | `REMOTE_SETTINGS_SOURCE_NAME` | name of remote config source |

