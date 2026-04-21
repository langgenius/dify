# Frontend Env Reference

> Generated from `web/env.ts`. Do not edit manually.

This reference documents frontend application env semantics and code defaults only.
Deploy-time defaults, `.env.example`, Docker files, and runtime-effective values are intentionally excluded.
Only env declared in `web/env.ts` is included. Dev-only tooling env outside that file is excluded.

## Browser-Public Variables

| Name | Visibility | Type | Default | Injection | Dataset Key | Description |
| --- | --- | --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_ALLOW_EMBED` | `browser-public` | `boolean` | `false` | `body-dataset` | `allowEmbed` | Default is not allow to embed into iframe to prevent Clickjacking: https://owasp.org/www-community/attacks/Clickjacking |
| `NEXT_PUBLIC_ALLOW_INLINE_STYLES` | `browser-public` | `boolean` | `false` | `body-dataset` | `allowInlineStyles` | Allow inline style attributes in Markdown rendering. Self-hosted opt-in for workflows using styled Jinja2 templates. |
| `NEXT_PUBLIC_ALLOW_UNSAFE_DATA_SCHEME` | `browser-public` | `boolean` | `false` | `body-dataset` | `allowUnsafeDataScheme` | Allow rendering unsafe URLs which have "data:" scheme. |
| `NEXT_PUBLIC_AMPLITUDE_API_KEY` | `browser-public` | `string` | `""` | `body-dataset` | `amplitudeApiKey` | The API key of amplitude |
| `NEXT_PUBLIC_API_PREFIX` | `browser-public` | `string` | `""` | `body-dataset` | `apiPrefix` | The base URL of console application, refers to the Console base URL of WEB service if console domain is different from api or web app domain. example: http://cloud.dify.ai/console/api |
| `NEXT_PUBLIC_BASE_PATH` | `browser-public` | `string` | `""` | `body-dataset` | `basePath` | The base path for the application |
| `NEXT_PUBLIC_BATCH_CONCURRENCY` | `browser-public` | `integer` | `5` | `body-dataset` | `batchConcurrency` | number of concurrency |
| `NEXT_PUBLIC_COOKIE_DOMAIN` | `browser-public` | `string` | `""` | `body-dataset` | `cookieDomain` | When the frontend and backend run on different subdomains, set NEXT_PUBLIC_COOKIE_DOMAIN=1. |
| `NEXT_PUBLIC_CSP_WHITELIST` | `browser-public` | `string` | `""` | `body-dataset` | `cspWhitelist` | CSP https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP |
| `NEXT_PUBLIC_DEPLOY_ENV` | `browser-public` | `literal["DEVELOPMENT", "PRODUCTION", "TESTING"]` | `""` | `body-dataset` | `deployEnv` | For production release, change this to PRODUCTION |
| `NEXT_PUBLIC_DISABLE_UPLOAD_IMAGE_AS_ICON` | `browser-public` | `boolean` | `false` | `body-dataset` | `disableUploadImageAsIcon` |  |
| `NEXT_PUBLIC_EDITION` | `browser-public` | `literal["SELF_HOSTED", "CLOUD"]` | `"SELF_HOSTED"` | `body-dataset` | `edition` | The deployment edition, SELF_HOSTED |
| `NEXT_PUBLIC_ENABLE_SINGLE_DOLLAR_LATEX` | `browser-public` | `boolean` | `false` | `body-dataset` | `enableSingleDollarLatex` | Enable inline LaTeX rendering with single dollar signs ($...$) Default is false for security reasons to prevent conflicts with regular text |
| `NEXT_PUBLIC_ENABLE_WEBSITE_FIRECRAWL` | `browser-public` | `boolean` | `true` | `body-dataset` | `enableWebsiteFirecrawl` |  |
| `NEXT_PUBLIC_ENABLE_WEBSITE_JINAREADER` | `browser-public` | `boolean` | `true` | `body-dataset` | `enableWebsiteJinareader` |  |
| `NEXT_PUBLIC_ENABLE_WEBSITE_WATERCRAWL` | `browser-public` | `boolean` | `false` | `body-dataset` | `enableWebsiteWatercrawl` |  |
| `NEXT_PUBLIC_INDEXING_MAX_SEGMENTATION_TOKENS_LENGTH` | `browser-public` | `integer` | `4000` | `body-dataset` | `indexingMaxSegmentationTokensLength` | The maximum number of tokens for segmentation |
| `NEXT_PUBLIC_IS_MARKETPLACE` | `browser-public` | `boolean` | `false` | `body-dataset` | `isMarketplace` |  |
| `NEXT_PUBLIC_LOOP_NODE_MAX_COUNT` | `browser-public` | `integer` | `100` | `body-dataset` | `loopNodeMaxCount` | Maximum loop count in the workflow |
| `NEXT_PUBLIC_MAINTENANCE_NOTICE` | `browser-public` | `string` | `""` | `body-dataset` | `maintenanceNotice` |  |
| `NEXT_PUBLIC_MARKETPLACE_API_PREFIX` | `browser-public` | `string` | `""` | `body-dataset` | `marketplaceApiPrefix` | The API PREFIX for MARKETPLACE |
| `NEXT_PUBLIC_MARKETPLACE_URL_PREFIX` | `browser-public` | `string` | `""` | `body-dataset` | `marketplaceUrlPrefix` | The URL for MARKETPLACE |
| `NEXT_PUBLIC_MAX_ITERATIONS_NUM` | `browser-public` | `integer` | `99` | `body-dataset` | `maxIterationsNum` | The maximum number of iterations for agent setting |
| `NEXT_PUBLIC_MAX_PARALLEL_LIMIT` | `browser-public` | `integer` | `10` | `body-dataset` | `maxParallelLimit` | Maximum number of Parallelism branches in the workflow |
| `NEXT_PUBLIC_MAX_TOOLS_NUM` | `browser-public` | `integer` | `10` | `body-dataset` | `maxToolsNum` | Maximum number of tools in the agent/workflow |
| `NEXT_PUBLIC_MAX_TREE_DEPTH` | `browser-public` | `integer` | `50` | `body-dataset` | `maxTreeDepth` | The maximum number of tree node depth for workflow |
| `NEXT_PUBLIC_PUBLIC_API_PREFIX` | `browser-public` | `string` | `""` | `body-dataset` | `publicApiPrefix` | The URL for Web APP, refers to the Web App base URL of WEB service if web app domain is different from console or api domain. example: http://udify.app/api |
| `NEXT_PUBLIC_SENTRY_DSN` | `browser-public` | `string` | `""` | `body-dataset` | `sentryDsn` | SENTRY |
| `NEXT_PUBLIC_SITE_ABOUT` | `browser-public` | `string` | `""` | `body-dataset` | `siteAbout` |  |
| `NEXT_PUBLIC_SOCKET_URL` | `browser-public` | `string` | `""` | `body-dataset` | `socketUrl` |  |
| `NEXT_PUBLIC_SUPPORT_EMAIL_ADDRESS` | `browser-public` | `string` | `""` | `body-dataset` | `supportEmailAddress` |  |
| `NEXT_PUBLIC_SUPPORT_MAIL_LOGIN` | `browser-public` | `boolean` | `false` | `body-dataset` | `supportMailLogin` |  |
| `NEXT_PUBLIC_TEXT_GENERATION_TIMEOUT_MS` | `browser-public` | `integer` | `60000` | `body-dataset` | `textGenerationTimeoutMs` | The timeout for the text generation in millisecond |
| `NEXT_PUBLIC_TOP_K_MAX_VALUE` | `browser-public` | `integer` | `10` | `body-dataset` | `topKMaxValue` | The maximum number of top-k value for RAG. |
| `NEXT_PUBLIC_UPLOAD_IMAGE_AS_ICON` | `browser-public` | `boolean` | `false` | `body-dataset` | `uploadImageAsIcon` | Disable Upload Image as WebApp icon default is false |
| `NEXT_PUBLIC_WEB_PREFIX` | `browser-public` | `string` | `""` | `body-dataset` | `webPrefix` |  |
| `NEXT_PUBLIC_ZENDESK_FIELD_ID_EMAIL` | `browser-public` | `string` | `""` | `body-dataset` | `zendeskFieldIdEmail` |  |
| `NEXT_PUBLIC_ZENDESK_FIELD_ID_ENVIRONMENT` | `browser-public` | `string` | `""` | `body-dataset` | `zendeskFieldIdEnvironment` |  |
| `NEXT_PUBLIC_ZENDESK_FIELD_ID_PLAN` | `browser-public` | `string` | `""` | `body-dataset` | `zendeskFieldIdPlan` |  |
| `NEXT_PUBLIC_ZENDESK_FIELD_ID_VERSION` | `browser-public` | `string` | `""` | `body-dataset` | `zendeskFieldIdVersion` |  |
| `NEXT_PUBLIC_ZENDESK_FIELD_ID_WORKSPACE_ID` | `browser-public` | `string` | `""` | `body-dataset` | `zendeskFieldIdWorkspaceId` |  |
| `NEXT_PUBLIC_ZENDESK_WIDGET_KEY` | `browser-public` | `string` | `""` | `body-dataset` | `zendeskWidgetKey` |  |

## Server-Only Variables

| Name | Visibility | Type | Default | Injection | Dataset Key | Description |
| --- | --- | --- | --- | --- | --- | --- |
| `INDEXING_MAX_SEGMENTATION_TOKENS_LENGTH` | `server-only` | `integer` | `4000` | `process-env` |  | Maximum length of segmentation tokens for indexing |
| `NEXT_TELEMETRY_DISABLED` | `server-only` | `boolean` | `""` | `process-env` |  | Disable Next.js Telemetry (https://nextjs.org/telemetry) |
| `PORT` | `server-only` | `integer` | `3000` | `process-env` |  |  |
| `TEXT_GENERATION_TIMEOUT_MS` | `server-only` | `integer` | `60000` | `process-env` |  | The timeout for the text generation in millisecond |

