import type { CamelCase, Replace } from 'string-ts'
import { createEnv } from '@t3-oss/env-nextjs'
import { concat, kebabCase, length, slice } from 'string-ts'
import * as z from 'zod'
import { isClient, isServer } from './utils/client'
import { ObjectFromEntries, ObjectKeys } from './utils/object'

const CLIENT_ENV_PREFIX = 'NEXT_PUBLIC_'
type ClientSchema = Record<`${typeof CLIENT_ENV_PREFIX}${string}`, z.ZodType>

const coercedBoolean = z.string()
  .refine(s => s === 'true' || s === 'false' || s === '0' || s === '1')
  .transform(s => s === 'true' || s === '1')
const coercedNumber = z.coerce.number().int().positive()

/// keep-sorted
const clientSchema = {
  /**
   * Default is not allow to embed into iframe to prevent Clickjacking: https://owasp.org/www-community/attacks/Clickjacking
   */
  NEXT_PUBLIC_ALLOW_EMBED: coercedBoolean.default(false),
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
  NEXT_PUBLIC_BASE_PATH: z.string().regex(/^\/.*[^/]$/).or(z.literal('')).default(''),
  /**
   * number of concurrency
   */
  NEXT_PUBLIC_BATCH_CONCURRENCY: coercedNumber.default(5),
  /**
   * When the frontend and backend run on different subdomains, set NEXT_PUBLIC_COOKIE_DOMAIN=1.
   */
  NEXT_PUBLIC_COOKIE_DOMAIN: z.string().optional(),
  /**
   * CSP https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP
   */
  NEXT_PUBLIC_CSP_WHITELIST: z.string().optional(),
  /**
   * For production release, change this to PRODUCTION
   */
  NEXT_PUBLIC_DEPLOY_ENV: z.enum(['DEVELOPMENT', 'PRODUCTION', 'TESTING']).optional(),
  NEXT_PUBLIC_DISABLE_UPLOAD_IMAGE_AS_ICON: coercedBoolean.default(false),
  /**
   * The deployment edition, SELF_HOSTED
   */
  NEXT_PUBLIC_EDITION: z.enum(['SELF_HOSTED', 'CLOUD']).default('SELF_HOSTED'),
  /**
   * Enable inline LaTeX rendering with single dollar signs ($...$)
   * Default is false for security reasons to prevent conflicts with regular text
   */
  NEXT_PUBLIC_ENABLE_SINGLE_DOLLAR_LATEX: coercedBoolean.default(false),
  NEXT_PUBLIC_ENABLE_WEBSITE_FIRECRAWL: coercedBoolean.default(true),
  NEXT_PUBLIC_ENABLE_WEBSITE_JINAREADER: coercedBoolean.default(true),
  NEXT_PUBLIC_ENABLE_WEBSITE_WATERCRAWL: coercedBoolean.default(false),
  /**
   * Github Access Token, used for invoking Github API
   */
  NEXT_PUBLIC_GITHUB_ACCESS_TOKEN: z.string().optional(),
  /**
   * The maximum number of tokens for segmentation
   */
  NEXT_PUBLIC_INDEXING_MAX_SEGMENTATION_TOKENS_LENGTH: coercedNumber.default(4000),
  NEXT_PUBLIC_IS_MARKETPLACE: coercedBoolean.default(false),
  /**
   * Maximum loop count in the workflow
   */
  NEXT_PUBLIC_LOOP_NODE_MAX_COUNT: coercedNumber.default(100),
  NEXT_PUBLIC_MAINTENANCE_NOTICE: z.string().optional(),
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
   * Disable Upload Image as WebApp icon default is false
   */
  NEXT_PUBLIC_UPLOAD_IMAGE_AS_ICON: coercedBoolean.default(false),
  NEXT_PUBLIC_WEB_PREFIX: z.url().optional(),
  NEXT_PUBLIC_ZENDESK_FIELD_ID_EMAIL: z.string().optional(),
  NEXT_PUBLIC_ZENDESK_FIELD_ID_ENVIRONMENT: z.string().optional(),
  NEXT_PUBLIC_ZENDESK_FIELD_ID_PLAN: z.string().optional(),
  NEXT_PUBLIC_ZENDESK_FIELD_ID_VERSION: z.string().optional(),
  NEXT_PUBLIC_ZENDESK_FIELD_ID_WORKSPACE_ID: z.string().optional(),
  NEXT_PUBLIC_ZENDESK_WIDGET_KEY: z.string().optional(),
} satisfies ClientSchema

export const env = createEnv({
  server: {
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
  },
  shared: {
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  },
  client: clientSchema,
  experimental__runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_ALLOW_EMBED: isServer ? process.env.NEXT_PUBLIC_ALLOW_EMBED : getRuntimeEnvFromBody('allowEmbed'),
    NEXT_PUBLIC_ALLOW_UNSAFE_DATA_SCHEME: isServer ? process.env.NEXT_PUBLIC_ALLOW_UNSAFE_DATA_SCHEME : getRuntimeEnvFromBody('allowUnsafeDataScheme'),
    NEXT_PUBLIC_AMPLITUDE_API_KEY: isServer ? process.env.NEXT_PUBLIC_AMPLITUDE_API_KEY : getRuntimeEnvFromBody('amplitudeApiKey'),
    NEXT_PUBLIC_API_PREFIX: isServer ? process.env.NEXT_PUBLIC_API_PREFIX : getRuntimeEnvFromBody('apiPrefix'),
    NEXT_PUBLIC_BASE_PATH: isServer ? process.env.NEXT_PUBLIC_BASE_PATH : getRuntimeEnvFromBody('basePath'),
    NEXT_PUBLIC_BATCH_CONCURRENCY: isServer ? process.env.NEXT_PUBLIC_BATCH_CONCURRENCY : getRuntimeEnvFromBody('batchConcurrency'),
    NEXT_PUBLIC_COOKIE_DOMAIN: isServer ? process.env.NEXT_PUBLIC_COOKIE_DOMAIN : getRuntimeEnvFromBody('cookieDomain'),
    NEXT_PUBLIC_CSP_WHITELIST: isServer ? process.env.NEXT_PUBLIC_CSP_WHITELIST : getRuntimeEnvFromBody('cspWhitelist'),
    NEXT_PUBLIC_DEPLOY_ENV: isServer ? process.env.NEXT_PUBLIC_DEPLOY_ENV : getRuntimeEnvFromBody('deployEnv'),
    NEXT_PUBLIC_DISABLE_UPLOAD_IMAGE_AS_ICON: isServer ? process.env.NEXT_PUBLIC_DISABLE_UPLOAD_IMAGE_AS_ICON : getRuntimeEnvFromBody('disableUploadImageAsIcon'),
    NEXT_PUBLIC_EDITION: isServer ? process.env.NEXT_PUBLIC_EDITION : getRuntimeEnvFromBody('edition'),
    NEXT_PUBLIC_ENABLE_SINGLE_DOLLAR_LATEX: isServer ? process.env.NEXT_PUBLIC_ENABLE_SINGLE_DOLLAR_LATEX : getRuntimeEnvFromBody('enableSingleDollarLatex'),
    NEXT_PUBLIC_ENABLE_WEBSITE_FIRECRAWL: isServer ? process.env.NEXT_PUBLIC_ENABLE_WEBSITE_FIRECRAWL : getRuntimeEnvFromBody('enableWebsiteFirecrawl'),
    NEXT_PUBLIC_ENABLE_WEBSITE_JINAREADER: isServer ? process.env.NEXT_PUBLIC_ENABLE_WEBSITE_JINAREADER : getRuntimeEnvFromBody('enableWebsiteJinareader'),
    NEXT_PUBLIC_ENABLE_WEBSITE_WATERCRAWL: isServer ? process.env.NEXT_PUBLIC_ENABLE_WEBSITE_WATERCRAWL : getRuntimeEnvFromBody('enableWebsiteWatercrawl'),
    NEXT_PUBLIC_GITHUB_ACCESS_TOKEN: isServer ? process.env.NEXT_PUBLIC_GITHUB_ACCESS_TOKEN : getRuntimeEnvFromBody('githubAccessToken'),
    NEXT_PUBLIC_INDEXING_MAX_SEGMENTATION_TOKENS_LENGTH: isServer ? process.env.NEXT_PUBLIC_INDEXING_MAX_SEGMENTATION_TOKENS_LENGTH : getRuntimeEnvFromBody('indexingMaxSegmentationTokensLength'),
    NEXT_PUBLIC_IS_MARKETPLACE: isServer ? process.env.NEXT_PUBLIC_IS_MARKETPLACE : getRuntimeEnvFromBody('isMarketplace'),
    NEXT_PUBLIC_LOOP_NODE_MAX_COUNT: isServer ? process.env.NEXT_PUBLIC_LOOP_NODE_MAX_COUNT : getRuntimeEnvFromBody('loopNodeMaxCount'),
    NEXT_PUBLIC_MAINTENANCE_NOTICE: isServer ? process.env.NEXT_PUBLIC_MAINTENANCE_NOTICE : getRuntimeEnvFromBody('maintenanceNotice'),
    NEXT_PUBLIC_MARKETPLACE_API_PREFIX: isServer ? process.env.NEXT_PUBLIC_MARKETPLACE_API_PREFIX : getRuntimeEnvFromBody('marketplaceApiPrefix'),
    NEXT_PUBLIC_MARKETPLACE_URL_PREFIX: isServer ? process.env.NEXT_PUBLIC_MARKETPLACE_URL_PREFIX : getRuntimeEnvFromBody('marketplaceUrlPrefix'),
    NEXT_PUBLIC_MAX_ITERATIONS_NUM: isServer ? process.env.NEXT_PUBLIC_MAX_ITERATIONS_NUM : getRuntimeEnvFromBody('maxIterationsNum'),
    NEXT_PUBLIC_MAX_PARALLEL_LIMIT: isServer ? process.env.NEXT_PUBLIC_MAX_PARALLEL_LIMIT : getRuntimeEnvFromBody('maxParallelLimit'),
    NEXT_PUBLIC_MAX_TOOLS_NUM: isServer ? process.env.NEXT_PUBLIC_MAX_TOOLS_NUM : getRuntimeEnvFromBody('maxToolsNum'),
    NEXT_PUBLIC_MAX_TREE_DEPTH: isServer ? process.env.NEXT_PUBLIC_MAX_TREE_DEPTH : getRuntimeEnvFromBody('maxTreeDepth'),
    NEXT_PUBLIC_PUBLIC_API_PREFIX: isServer ? process.env.NEXT_PUBLIC_PUBLIC_API_PREFIX : getRuntimeEnvFromBody('publicApiPrefix'),
    NEXT_PUBLIC_SENTRY_DSN: isServer ? process.env.NEXT_PUBLIC_SENTRY_DSN : getRuntimeEnvFromBody('sentryDsn'),
    NEXT_PUBLIC_SITE_ABOUT: isServer ? process.env.NEXT_PUBLIC_SITE_ABOUT : getRuntimeEnvFromBody('siteAbout'),
    NEXT_PUBLIC_SUPPORT_MAIL_LOGIN: isServer ? process.env.NEXT_PUBLIC_SUPPORT_MAIL_LOGIN : getRuntimeEnvFromBody('supportMailLogin'),
    NEXT_PUBLIC_TEXT_GENERATION_TIMEOUT_MS: isServer ? process.env.NEXT_PUBLIC_TEXT_GENERATION_TIMEOUT_MS : getRuntimeEnvFromBody('textGenerationTimeoutMs'),
    NEXT_PUBLIC_TOP_K_MAX_VALUE: isServer ? process.env.NEXT_PUBLIC_TOP_K_MAX_VALUE : getRuntimeEnvFromBody('topKMaxValue'),
    NEXT_PUBLIC_UPLOAD_IMAGE_AS_ICON: isServer ? process.env.NEXT_PUBLIC_UPLOAD_IMAGE_AS_ICON : getRuntimeEnvFromBody('uploadImageAsIcon'),
    NEXT_PUBLIC_WEB_PREFIX: isServer ? process.env.NEXT_PUBLIC_WEB_PREFIX : getRuntimeEnvFromBody('webPrefix'),
    NEXT_PUBLIC_ZENDESK_FIELD_ID_EMAIL: isServer ? process.env.NEXT_PUBLIC_ZENDESK_FIELD_ID_EMAIL : getRuntimeEnvFromBody('zendeskFieldIdEmail'),
    NEXT_PUBLIC_ZENDESK_FIELD_ID_ENVIRONMENT: isServer ? process.env.NEXT_PUBLIC_ZENDESK_FIELD_ID_ENVIRONMENT : getRuntimeEnvFromBody('zendeskFieldIdEnvironment'),
    NEXT_PUBLIC_ZENDESK_FIELD_ID_PLAN: isServer ? process.env.NEXT_PUBLIC_ZENDESK_FIELD_ID_PLAN : getRuntimeEnvFromBody('zendeskFieldIdPlan'),
    NEXT_PUBLIC_ZENDESK_FIELD_ID_VERSION: isServer ? process.env.NEXT_PUBLIC_ZENDESK_FIELD_ID_VERSION : getRuntimeEnvFromBody('zendeskFieldIdVersion'),
    NEXT_PUBLIC_ZENDESK_FIELD_ID_WORKSPACE_ID: isServer ? process.env.NEXT_PUBLIC_ZENDESK_FIELD_ID_WORKSPACE_ID : getRuntimeEnvFromBody('zendeskFieldIdWorkspaceId'),
    NEXT_PUBLIC_ZENDESK_WIDGET_KEY: isServer ? process.env.NEXT_PUBLIC_ZENDESK_WIDGET_KEY : getRuntimeEnvFromBody('zendeskWidgetKey'),
  },
  emptyStringAsUndefined: true,
})

type ClientEnvKey = keyof typeof clientSchema
type DatasetKey = CamelCase<Replace<ClientEnvKey, typeof CLIENT_ENV_PREFIX>>

/**
 * Browser-only function to get runtime env value from HTML body dataset.
 */
function getRuntimeEnvFromBody(key: DatasetKey) {
  if (typeof window === 'undefined') {
    throw new TypeError('getRuntimeEnvFromBody can only be called in the browser')
  }

  const value = document.body.dataset[key]
  return value || undefined
}

/**
 * Server-only function to get dataset map for embedding into the HTML body.
 */
export function getDatasetMap() {
  if (isClient) {
    throw new TypeError('getDatasetMap can only be called on the server')
  }
  return ObjectFromEntries(
    ObjectKeys(clientSchema)
      .map(envKey => [
        concat('data-', kebabCase(slice(envKey, length(CLIENT_ENV_PREFIX)))),
        env[envKey],
      ]),
  )
}
