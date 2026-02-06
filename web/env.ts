import type { CamelCase, Replace } from 'string-ts'
import { createEnv } from '@t3-oss/env-nextjs'
import { concat, kebabCase, length, slice } from 'string-ts'
import * as z from 'zod'
import { isClient, isServer } from './utils/client'
import { ObjectFromEntries, ObjectKeys } from './utils/object'

const CLIENT_ENV_PREFIX = 'NEXT_PUBLIC_'
type ClientSchema = Record<`${typeof CLIENT_ENV_PREFIX}${string}`, z.ZodType>

const optionalString = z.string().optional()

/// keep-sorted
const clientSchema = {
  NEXT_PUBLIC_ALLOW_EMBED: optionalString,
  NEXT_PUBLIC_ALLOW_UNSAFE_DATA_SCHEME: optionalString,
  NEXT_PUBLIC_AMPLITUDE_API_KEY: optionalString,
  NEXT_PUBLIC_API_PREFIX: optionalString,
  NEXT_PUBLIC_BASE_PATH: optionalString,
  NEXT_PUBLIC_BATCH_CONCURRENCY: optionalString,
  NEXT_PUBLIC_COOKIE_DOMAIN: optionalString,
  NEXT_PUBLIC_CSP_WHITELIST: optionalString,
  NEXT_PUBLIC_DEPLOY_ENV: optionalString,
  NEXT_PUBLIC_DISABLE_UPLOAD_IMAGE_AS_ICON: optionalString,
  NEXT_PUBLIC_EDITION: optionalString,
  NEXT_PUBLIC_ENABLE_SINGLE_DOLLAR_LATEX: optionalString,
  NEXT_PUBLIC_ENABLE_WEBSITE_FIRECRAWL: optionalString,
  NEXT_PUBLIC_ENABLE_WEBSITE_JINAREADER: optionalString,
  NEXT_PUBLIC_ENABLE_WEBSITE_WATERCRAWL: optionalString,
  NEXT_PUBLIC_GITHUB_ACCESS_TOKEN: optionalString,
  NEXT_PUBLIC_INDEXING_MAX_SEGMENTATION_TOKENS_LENGTH: optionalString,
  NEXT_PUBLIC_IS_MARKETPLACE: optionalString,
  NEXT_PUBLIC_LOOP_NODE_MAX_COUNT: optionalString,
  NEXT_PUBLIC_MAINTENANCE_NOTICE: optionalString,
  NEXT_PUBLIC_MARKETPLACE_API_PREFIX: optionalString,
  NEXT_PUBLIC_MARKETPLACE_URL_PREFIX: optionalString,
  NEXT_PUBLIC_MAX_ITERATIONS_NUM: optionalString,
  NEXT_PUBLIC_MAX_PARALLEL_LIMIT: optionalString,
  NEXT_PUBLIC_MAX_TOOLS_NUM: optionalString,
  NEXT_PUBLIC_MAX_TREE_DEPTH: optionalString,
  NEXT_PUBLIC_PUBLIC_API_PREFIX: optionalString,
  NEXT_PUBLIC_SENTRY_DSN: optionalString,
  NEXT_PUBLIC_SITE_ABOUT: optionalString,
  NEXT_PUBLIC_SUPPORT_MAIL_LOGIN: optionalString,
  NEXT_PUBLIC_TEXT_GENERATION_TIMEOUT_MS: optionalString,
  NEXT_PUBLIC_TOP_K_MAX_VALUE: optionalString,
  NEXT_PUBLIC_UPLOAD_IMAGE_AS_ICON: optionalString,
  NEXT_PUBLIC_WEB_PREFIX: optionalString,
  NEXT_PUBLIC_ZENDESK_FIELD_ID_EMAIL: optionalString,
  NEXT_PUBLIC_ZENDESK_FIELD_ID_ENVIRONMENT: optionalString,
  NEXT_PUBLIC_ZENDESK_FIELD_ID_PLAN: optionalString,
  NEXT_PUBLIC_ZENDESK_FIELD_ID_VERSION: optionalString,
  NEXT_PUBLIC_ZENDESK_FIELD_ID_WORKSPACE_ID: optionalString,
  NEXT_PUBLIC_ZENDESK_WIDGET_KEY: optionalString,
} satisfies ClientSchema

export const env = createEnv({
  server: {
    ANALYZE: optionalString,
    INDEXING_MAX_SEGMENTATION_TOKENS_LENGTH: optionalString,
    NEXT_TELEMETRY_DISABLED: optionalString,
    PORT: optionalString,
    TEXT_GENERATION_TIMEOUT_MS: optionalString,
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
