import type { CamelCase, Replace } from 'string-ts'
import { createEnv } from '@t3-oss/env-nextjs'
import { concat, kebabCase, length, slice } from 'string-ts'
import * as z from 'zod'
import { isClient, isServer } from './utils/client'
import { ObjectFromEntries, ObjectKeys } from './utils/object'

const CLIENT_ENV_PREFIX = 'NEXT_PUBLIC_'
type ClientSchema = Record<`${typeof CLIENT_ENV_PREFIX}${string}`, z.ZodType>

const coercedBoolean = z
  .string()
  .refine((s) => s === 'true' || s === 'false' || s === '0' || s === '1')
  .transform((s) => s === 'true' || s === '1')
const coercedNumber = z.coerce.number().int().positive()

/// Keep keys sorted except grouped feature-specific blocks.
const clientSchema = {
  /**
   * Default is not allow to embed into iframe to prevent Clickjacking: https://owasp.org/www-community/attacks/Clickjacking
   */
  NEXT_PUBLIC_ALLOW_EMBED: coercedBoolean.default(false),
  /**
   * Allow inline style attributes in Markdown rendering.
   * Self-hosted opt-in for workflows using styled Jinja2 templates.
   */
  NEXT_PUBLIC_ALLOW_INLINE_STYLES: coercedBoolean.default(false),
  /**
   * Allow rendering unsafe URLs which have "data:" scheme.
   */
  NEXT_PUBLIC_ALLOW_UNSAFE_DATA_SCHEME: coercedBoolean.default(false),
  /**
   * The API key of amplitude
   */
  NEXT_PUBLIC_AMPLITUDE_API_KEY: z.string().optional(),
  /**
   * The base URL of console application, refers to the Console base URL of WEB service if console domain is
   * different from api or web app domain.
   * example: http://cloud.dify.ai/console/api
   */
  NEXT_PUBLIC_API_PREFIX: z.string().optional(),
  /**
   * The base path for the application
   */
  NEXT_PUBLIC_BASE_PATH: z
    .string()
    .regex(/^\/.*[^/]$/)
    .or(z.literal(''))
    .default(''),
  /**
   * number of concurrency
   */
  NEXT_PUBLIC_BATCH_CONCURRENCY: coercedNumber.default(5),
  /**
   * When the frontend and backend run on different subdomains, set NEXT_PUBLIC_COOKIE_DOMAIN=1.
   */
  NEXT_PUBLIC_COOKIE_DOMAIN: z.string().optional(),
  /**
   * CookieYes site key for the Dify Cloud consent banner.
   */
  NEXT_PUBLIC_COOKIEYES_SITE_KEY: z
    .string()
    .regex(/^[\w-]+$/)
    .optional(),
  /**
   * CSP https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP
   */
  NEXT_PUBLIC_CSP_WHITELIST: z.string().optional(),
  /**
   * For production release, change this to PRODUCTION
   */
  NEXT_PUBLIC_DEPLOY_ENV: z.enum(['DEVELOPMENT', 'PRODUCTION', 'TESTING']).optional(),
  NEXT_PUBLIC_DISABLE_UPLOAD_IMAGE_AS_ICON: coercedBoolean.default(false),
  NEXT_PUBLIC_ENABLE_ACCESS_TOKEN: coercedBoolean.default(false),
  NEXT_PUBLIC_ENABLE_AGENT_V2: coercedBoolean.default(false),
  /**
   * Surface the Agent v2 node inside Chatflow (advanced-chat) apps.
   * Requires NEXT_PUBLIC_ENABLE_AGENT_V2. Disabled by default so Chatflow keeps
   * showing only the legacy Agent node until this is explicitly turned on.
   */
  NEXT_PUBLIC_ENABLE_AGENT_V2_IN_CHATFLOW: coercedBoolean.default(false),
  /**
   * Enable preview features that are still in development.
   * Currently gates the `/create` and `/refine` slash commands in the
   * "Go to Anything" command palette (Cmd/Ctrl+K).
   */
  NEXT_PUBLIC_ENABLE_FEATURE_PREVIEW: coercedBoolean.default(true),
  /**
   * Enable HITL IM, Contacts, V2 editing, migration, and approval entry points.
   * When disabled, keep legacy V1 workflows available without exposing V2 UI.
   */
  NEXT_PUBLIC_ENABLE_HITL_IM: coercedBoolean.default(false),
  /**
   * Enable inline LaTeX rendering with single dollar signs ($...$)
   * Default is false for security reasons to prevent conflicts with regular text
   */
  NEXT_PUBLIC_ENABLE_SINGLE_DOLLAR_LATEX: coercedBoolean.default(false),
  NEXT_PUBLIC_ENABLE_WEBSITE_FIRECRAWL: coercedBoolean.default(true),
  NEXT_PUBLIC_ENABLE_WEBSITE_JINAREADER: coercedBoolean.default(true),
  NEXT_PUBLIC_ENABLE_WEBSITE_WATERCRAWL: coercedBoolean.default(false),
  /**
   * The maximum number of tokens for segmentation
   */
  NEXT_PUBLIC_INDEXING_MAX_SEGMENTATION_TOKENS_LENGTH: coercedNumber.default(4000),
  NEXT_PUBLIC_IS_MARKETPLACE: coercedBoolean.default(false),
  /**
   * Maximum loop count in the workflow
   */
  NEXT_PUBLIC_LOOP_NODE_MAX_COUNT: coercedNumber.default(100),
  /**
   * Additional literal characters allowed in Markdown form field names.
   */
  NEXT_PUBLIC_MARKDOWN_FORM_FIELD_NAME_EXTRA_CHARS: z.string().default(''),
  /**
   * Maximum length of Markdown form field names.
   */
  NEXT_PUBLIC_MARKDOWN_FORM_FIELD_NAME_MAX_LENGTH: coercedNumber.default(128),
  /**
   * The API PREFIX for MARKETPLACE
   */
  NEXT_PUBLIC_MARKETPLACE_API_PREFIX: z.url().optional(),
  /**
   * The URL for MARKETPLACE
   */
  NEXT_PUBLIC_MARKETPLACE_URL_PREFIX: z.url().optional(),
  /**
   * The maximum number of iterations for agent setting
   */
  NEXT_PUBLIC_MAX_ITERATIONS_NUM: coercedNumber.default(99),
  /**
   * Maximum number of Parallelism branches in the workflow
   */
  NEXT_PUBLIC_MAX_PARALLEL_LIMIT: coercedNumber.default(10),
  /**
   * Maximum number of tools in the agent/workflow
   */
  NEXT_PUBLIC_MAX_TOOLS_NUM: coercedNumber.default(10),
  /**
   * The maximum number of tree node depth for workflow
   */
  NEXT_PUBLIC_MAX_TREE_DEPTH: coercedNumber.default(50),
  /**
   * The URL for Web APP, refers to the Web App base URL of WEB service if web app domain is different from
   * console or api domain.
   * example: http://udify.app/api
   */
  NEXT_PUBLIC_PUBLIC_API_PREFIX: z.string().optional(),
  /**
   * SENTRY
   */
  NEXT_PUBLIC_SENTRY_DSN: z.string().optional(),
  NEXT_PUBLIC_SITE_ABOUT: z.string().optional(),
  NEXT_PUBLIC_SOCKET_URL: z.string().optional(),
  NEXT_PUBLIC_SUPPORT_EMAIL_ADDRESS: z.email().optional(),
  NEXT_PUBLIC_SUPPORT_MAIL_LOGIN: coercedBoolean.default(false),
  /**
   * The timeout for the text generation in millisecond
   */
  NEXT_PUBLIC_TEXT_GENERATION_TIMEOUT_MS: coercedNumber.default(60000),
  /**
   * The maximum number of top-k value for RAG.
   */
  NEXT_PUBLIC_TOP_K_MAX_VALUE: coercedNumber.default(10),
  /**
   * Cloudflare Turnstile site key for Dify Cloud sign-in verification.
   */
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().optional(),
  /**
   * Disable Upload Image as WebApp icon default is false
   */
  NEXT_PUBLIC_UPLOAD_IMAGE_AS_ICON: coercedBoolean.default(false),
  NEXT_PUBLIC_WEB_PREFIX: z.url().optional(),
  /**
   * The timeout for the cmd+k workflow generation in millisecond
   */
  NEXT_PUBLIC_WORKFLOW_GENERATION_TIMEOUT_MS: coercedNumber.default(180000),
  NEXT_PUBLIC_ZENDESK_FIELD_ID_EMAIL: z.string().optional(),
  NEXT_PUBLIC_ZENDESK_FIELD_ID_ENVIRONMENT: z.string().optional(),
  NEXT_PUBLIC_ZENDESK_FIELD_ID_PLAN: z.string().optional(),
  NEXT_PUBLIC_ZENDESK_FIELD_ID_VERSION: z.string().optional(),
  NEXT_PUBLIC_ZENDESK_FIELD_ID_WORKSPACE_ID: z.string().optional(),
  NEXT_PUBLIC_ZENDESK_WIDGET_KEY: z.string().optional(),
} satisfies ClientSchema

export const env = createEnv({
  server: {
    CONSOLE_API_URL: z.string().optional(),
    SERVER_CONSOLE_API_URL: z.string().optional(),
    /**
     * Maximum length of segmentation tokens for indexing
     */
    INDEXING_MAX_SEGMENTATION_TOKENS_LENGTH: coercedNumber.default(4000),
    /**
     * Disable Next.js Telemetry (https://nextjs.org/telemetry)
     */
    NEXT_TELEMETRY_DISABLED: coercedBoolean.optional(),
    PORT: coercedNumber.default(3000),
    /**
     * The timeout for the text generation in millisecond
     */
    TEXT_GENERATION_TIMEOUT_MS: coercedNumber.default(60000),
    /** Ingress proof for the optional pre-render WebApp gate; never expose to the browser. */
    WEBAPP_ACCESS_PREFLIGHT_PROXY_SECRET: z.string().optional(),
    /** Fixed internal Gateway access-mode URL. Unset preserves self-hosted routing. */
    WEBAPP_ACCESS_PREFLIGHT_URL: z.url().optional(),
    /**
     * The timeout for the cmd+k workflow generation in millisecond
     */
    WORKFLOW_GENERATION_TIMEOUT_MS: coercedNumber.default(180000),
  },
  client: clientSchema,
  experimental__runtimeEnv: {
    NEXT_PUBLIC_ALLOW_EMBED: isServer
      ? process.env.NEXT_PUBLIC_ALLOW_EMBED
      : getRuntimeEnv('allowEmbed'),
    NEXT_PUBLIC_ALLOW_INLINE_STYLES: isServer
      ? process.env.NEXT_PUBLIC_ALLOW_INLINE_STYLES
      : getRuntimeEnv('allowInlineStyles'),
    NEXT_PUBLIC_ALLOW_UNSAFE_DATA_SCHEME: isServer
      ? process.env.NEXT_PUBLIC_ALLOW_UNSAFE_DATA_SCHEME
      : getRuntimeEnv('allowUnsafeDataScheme'),
    NEXT_PUBLIC_AMPLITUDE_API_KEY: isServer
      ? process.env.NEXT_PUBLIC_AMPLITUDE_API_KEY
      : getRuntimeEnv('amplitudeApiKey'),
    NEXT_PUBLIC_API_PREFIX: isServer
      ? process.env.NEXT_PUBLIC_API_PREFIX
      : getRuntimeEnv('apiPrefix'),
    NEXT_PUBLIC_BASE_PATH: isServer ? process.env.NEXT_PUBLIC_BASE_PATH : getRuntimeEnv('basePath'),
    NEXT_PUBLIC_BATCH_CONCURRENCY: isServer
      ? process.env.NEXT_PUBLIC_BATCH_CONCURRENCY
      : getRuntimeEnv('batchConcurrency'),
    NEXT_PUBLIC_COOKIE_DOMAIN: isServer
      ? process.env.NEXT_PUBLIC_COOKIE_DOMAIN
      : getRuntimeEnv('cookieDomain'),
    NEXT_PUBLIC_COOKIEYES_SITE_KEY: isServer
      ? process.env.NEXT_PUBLIC_COOKIEYES_SITE_KEY
      : getRuntimeEnv('cookieyesSiteKey'),
    NEXT_PUBLIC_CSP_WHITELIST: isServer
      ? process.env.NEXT_PUBLIC_CSP_WHITELIST
      : getRuntimeEnv('cspWhitelist'),
    NEXT_PUBLIC_DEPLOY_ENV: isServer
      ? process.env.NEXT_PUBLIC_DEPLOY_ENV
      : getRuntimeEnv('deployEnv'),
    NEXT_PUBLIC_DISABLE_UPLOAD_IMAGE_AS_ICON: isServer
      ? process.env.NEXT_PUBLIC_DISABLE_UPLOAD_IMAGE_AS_ICON
      : getRuntimeEnv('disableUploadImageAsIcon'),
    NEXT_PUBLIC_ENABLE_ACCESS_TOKEN: isServer
      ? process.env.NEXT_PUBLIC_ENABLE_ACCESS_TOKEN
      : getRuntimeEnv('enableAccessToken'),
    NEXT_PUBLIC_ENABLE_AGENT_V2: isServer
      ? process.env.NEXT_PUBLIC_ENABLE_AGENT_V2
      : getRuntimeEnv('enableAgentV2'),
    NEXT_PUBLIC_ENABLE_AGENT_V2_IN_CHATFLOW: isServer
      ? process.env.NEXT_PUBLIC_ENABLE_AGENT_V2_IN_CHATFLOW
      : getRuntimeEnv('enableAgentV2InChatflow'),
    NEXT_PUBLIC_ENABLE_FEATURE_PREVIEW: isServer
      ? process.env.NEXT_PUBLIC_ENABLE_FEATURE_PREVIEW
      : getRuntimeEnv('enableFeaturePreview'),
    NEXT_PUBLIC_ENABLE_HITL_IM: isServer
      ? process.env.NEXT_PUBLIC_ENABLE_HITL_IM
      : getRuntimeEnv('enableHitlIm'),
    NEXT_PUBLIC_ENABLE_SINGLE_DOLLAR_LATEX: isServer
      ? process.env.NEXT_PUBLIC_ENABLE_SINGLE_DOLLAR_LATEX
      : getRuntimeEnv('enableSingleDollarLatex'),
    NEXT_PUBLIC_ENABLE_WEBSITE_FIRECRAWL: isServer
      ? process.env.NEXT_PUBLIC_ENABLE_WEBSITE_FIRECRAWL
      : getRuntimeEnv('enableWebsiteFirecrawl'),
    NEXT_PUBLIC_ENABLE_WEBSITE_JINAREADER: isServer
      ? process.env.NEXT_PUBLIC_ENABLE_WEBSITE_JINAREADER
      : getRuntimeEnv('enableWebsiteJinareader'),
    NEXT_PUBLIC_ENABLE_WEBSITE_WATERCRAWL: isServer
      ? process.env.NEXT_PUBLIC_ENABLE_WEBSITE_WATERCRAWL
      : getRuntimeEnv('enableWebsiteWatercrawl'),
    NEXT_PUBLIC_INDEXING_MAX_SEGMENTATION_TOKENS_LENGTH: isServer
      ? process.env.NEXT_PUBLIC_INDEXING_MAX_SEGMENTATION_TOKENS_LENGTH
      : getRuntimeEnv('indexingMaxSegmentationTokensLength'),
    NEXT_PUBLIC_IS_MARKETPLACE: isServer
      ? process.env.NEXT_PUBLIC_IS_MARKETPLACE
      : getRuntimeEnv('isMarketplace'),
    NEXT_PUBLIC_LOOP_NODE_MAX_COUNT: isServer
      ? process.env.NEXT_PUBLIC_LOOP_NODE_MAX_COUNT
      : getRuntimeEnv('loopNodeMaxCount'),
    NEXT_PUBLIC_MARKDOWN_FORM_FIELD_NAME_EXTRA_CHARS: isServer
      ? process.env.NEXT_PUBLIC_MARKDOWN_FORM_FIELD_NAME_EXTRA_CHARS
      : getRuntimeEnv('markdownFormFieldNameExtraChars'),
    NEXT_PUBLIC_MARKDOWN_FORM_FIELD_NAME_MAX_LENGTH: isServer
      ? process.env.NEXT_PUBLIC_MARKDOWN_FORM_FIELD_NAME_MAX_LENGTH
      : getRuntimeEnv('markdownFormFieldNameMaxLength'),
    NEXT_PUBLIC_MARKETPLACE_API_PREFIX: isServer
      ? process.env.NEXT_PUBLIC_MARKETPLACE_API_PREFIX
      : getRuntimeEnv('marketplaceApiPrefix'),
    NEXT_PUBLIC_MARKETPLACE_URL_PREFIX: isServer
      ? process.env.NEXT_PUBLIC_MARKETPLACE_URL_PREFIX
      : getRuntimeEnv('marketplaceUrlPrefix'),
    NEXT_PUBLIC_MAX_ITERATIONS_NUM: isServer
      ? process.env.NEXT_PUBLIC_MAX_ITERATIONS_NUM
      : getRuntimeEnv('maxIterationsNum'),
    NEXT_PUBLIC_MAX_PARALLEL_LIMIT: isServer
      ? process.env.NEXT_PUBLIC_MAX_PARALLEL_LIMIT
      : getRuntimeEnv('maxParallelLimit'),
    NEXT_PUBLIC_MAX_TOOLS_NUM: isServer
      ? process.env.NEXT_PUBLIC_MAX_TOOLS_NUM
      : getRuntimeEnv('maxToolsNum'),
    NEXT_PUBLIC_MAX_TREE_DEPTH: isServer
      ? process.env.NEXT_PUBLIC_MAX_TREE_DEPTH
      : getRuntimeEnv('maxTreeDepth'),
    NEXT_PUBLIC_PUBLIC_API_PREFIX: isServer
      ? process.env.NEXT_PUBLIC_PUBLIC_API_PREFIX
      : getRuntimeEnv('publicApiPrefix'),
    NEXT_PUBLIC_SENTRY_DSN: isServer
      ? process.env.NEXT_PUBLIC_SENTRY_DSN
      : getRuntimeEnv('sentryDsn'),
    NEXT_PUBLIC_SITE_ABOUT: isServer
      ? process.env.NEXT_PUBLIC_SITE_ABOUT
      : getRuntimeEnv('siteAbout'),
    NEXT_PUBLIC_SOCKET_URL: isServer
      ? process.env.NEXT_PUBLIC_SOCKET_URL
      : getRuntimeEnv('socketUrl'),
    NEXT_PUBLIC_SUPPORT_EMAIL_ADDRESS: isServer
      ? process.env.NEXT_PUBLIC_SUPPORT_EMAIL_ADDRESS
      : getRuntimeEnv('supportEmailAddress'),
    NEXT_PUBLIC_SUPPORT_MAIL_LOGIN: isServer
      ? process.env.NEXT_PUBLIC_SUPPORT_MAIL_LOGIN
      : getRuntimeEnv('supportMailLogin'),
    NEXT_PUBLIC_TEXT_GENERATION_TIMEOUT_MS: isServer
      ? process.env.NEXT_PUBLIC_TEXT_GENERATION_TIMEOUT_MS
      : getRuntimeEnv('textGenerationTimeoutMs'),
    NEXT_PUBLIC_TOP_K_MAX_VALUE: isServer
      ? process.env.NEXT_PUBLIC_TOP_K_MAX_VALUE
      : getRuntimeEnv('topKMaxValue'),
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: isServer
      ? process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
      : getRuntimeEnv('turnstileSiteKey'),
    NEXT_PUBLIC_UPLOAD_IMAGE_AS_ICON: isServer
      ? process.env.NEXT_PUBLIC_UPLOAD_IMAGE_AS_ICON
      : getRuntimeEnv('uploadImageAsIcon'),
    NEXT_PUBLIC_WEB_PREFIX: isServer
      ? process.env.NEXT_PUBLIC_WEB_PREFIX
      : getRuntimeEnv('webPrefix'),
    NEXT_PUBLIC_WORKFLOW_GENERATION_TIMEOUT_MS: isServer
      ? process.env.NEXT_PUBLIC_WORKFLOW_GENERATION_TIMEOUT_MS
      : getRuntimeEnv('workflowGenerationTimeoutMs'),
    NEXT_PUBLIC_ZENDESK_FIELD_ID_EMAIL: isServer
      ? process.env.NEXT_PUBLIC_ZENDESK_FIELD_ID_EMAIL
      : getRuntimeEnv('zendeskFieldIdEmail'),
    NEXT_PUBLIC_ZENDESK_FIELD_ID_ENVIRONMENT: isServer
      ? process.env.NEXT_PUBLIC_ZENDESK_FIELD_ID_ENVIRONMENT
      : getRuntimeEnv('zendeskFieldIdEnvironment'),
    NEXT_PUBLIC_ZENDESK_FIELD_ID_PLAN: isServer
      ? process.env.NEXT_PUBLIC_ZENDESK_FIELD_ID_PLAN
      : getRuntimeEnv('zendeskFieldIdPlan'),
    NEXT_PUBLIC_ZENDESK_FIELD_ID_VERSION: isServer
      ? process.env.NEXT_PUBLIC_ZENDESK_FIELD_ID_VERSION
      : getRuntimeEnv('zendeskFieldIdVersion'),
    NEXT_PUBLIC_ZENDESK_FIELD_ID_WORKSPACE_ID: isServer
      ? process.env.NEXT_PUBLIC_ZENDESK_FIELD_ID_WORKSPACE_ID
      : getRuntimeEnv('zendeskFieldIdWorkspaceId'),
    NEXT_PUBLIC_ZENDESK_WIDGET_KEY: isServer
      ? process.env.NEXT_PUBLIC_ZENDESK_WIDGET_KEY
      : getRuntimeEnv('zendeskWidgetKey'),
  },
  emptyStringAsUndefined: true,
})

type ClientEnvKey = keyof typeof clientSchema
type DatasetKey = CamelCase<Replace<ClientEnvKey, typeof CLIENT_ENV_PREFIX>>

function getDatasetAttributeName(envKey: ClientEnvKey) {
  const datasetName = kebabCase(slice(envKey, length(CLIENT_ENV_PREFIX))).replace(/-(\d)/g, '$1')
  return concat('data-', datasetName)
}

/**
 * Browser-only function to get runtime env value from the root element dataset.
 * The root element exists before streamed body content, so module-level reads are safe.
 */
function getRuntimeEnv(key: DatasetKey) {
  if (typeof window === 'undefined') {
    throw new TypeError('getRuntimeEnv can only be called in the browser')
  }

  const value = document.documentElement.dataset[key]
  return value || undefined
}

/**
 * Server-only function to get dataset map for embedding into the root HTML element.
 */
export function getDatasetMap() {
  if (isClient) {
    throw new TypeError('getDatasetMap can only be called on the server')
  }
  return ObjectFromEntries(
    ObjectKeys(clientSchema).map((envKey) => [getDatasetAttributeName(envKey), env[envKey]]),
  )
}
