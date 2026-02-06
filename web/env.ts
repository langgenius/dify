import { createEnv } from '@t3-oss/env-nextjs'
import { camelCase, kebabCase, replace } from 'string-ts'
import * as z from 'zod'
import { isServer } from './utils/client'

const optionalString = z.string().optional()
const CLIENT_ENV_PREFIX = 'NEXT_PUBLIC_' as const
type ClientSchema = Record<`${typeof CLIENT_ENV_PREFIX}${string}`, z.ZodType>

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

type ClientEnvKey = keyof typeof clientSchema

function getRuntimeEnvFromBody<K extends ClientEnvKey>(key: K) {
  if (typeof window === 'undefined') {
    throw new TypeError('getRuntimeEnvFromBody can only be called in the browser')
  }

  const value = document.body.dataset[camelCase(replace(key, CLIENT_ENV_PREFIX, ''))]
  return value || undefined
}

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
    NEXT_PUBLIC_ALLOW_EMBED: isServer ? process.env.NEXT_PUBLIC_ALLOW_EMBED : getRuntimeEnvFromBody('NEXT_PUBLIC_ALLOW_EMBED'),
    NEXT_PUBLIC_ALLOW_UNSAFE_DATA_SCHEME: isServer ? process.env.NEXT_PUBLIC_ALLOW_UNSAFE_DATA_SCHEME : getRuntimeEnvFromBody('NEXT_PUBLIC_ALLOW_UNSAFE_DATA_SCHEME'),
    NEXT_PUBLIC_AMPLITUDE_API_KEY: isServer ? process.env.NEXT_PUBLIC_AMPLITUDE_API_KEY : getRuntimeEnvFromBody('NEXT_PUBLIC_AMPLITUDE_API_KEY'),
    NEXT_PUBLIC_API_PREFIX: isServer ? process.env.NEXT_PUBLIC_API_PREFIX : getRuntimeEnvFromBody('NEXT_PUBLIC_API_PREFIX'),
    NEXT_PUBLIC_BASE_PATH: isServer ? process.env.NEXT_PUBLIC_BASE_PATH : getRuntimeEnvFromBody('NEXT_PUBLIC_BASE_PATH'),
    NEXT_PUBLIC_BATCH_CONCURRENCY: isServer ? process.env.NEXT_PUBLIC_BATCH_CONCURRENCY : getRuntimeEnvFromBody('NEXT_PUBLIC_BATCH_CONCURRENCY'),
    NEXT_PUBLIC_COOKIE_DOMAIN: isServer ? process.env.NEXT_PUBLIC_COOKIE_DOMAIN : getRuntimeEnvFromBody('NEXT_PUBLIC_COOKIE_DOMAIN'),
    NEXT_PUBLIC_CSP_WHITELIST: isServer ? process.env.NEXT_PUBLIC_CSP_WHITELIST : getRuntimeEnvFromBody('NEXT_PUBLIC_CSP_WHITELIST'),
    NEXT_PUBLIC_DEPLOY_ENV: isServer ? process.env.NEXT_PUBLIC_DEPLOY_ENV : getRuntimeEnvFromBody('NEXT_PUBLIC_DEPLOY_ENV'),
    NEXT_PUBLIC_DISABLE_UPLOAD_IMAGE_AS_ICON: isServer ? process.env.NEXT_PUBLIC_DISABLE_UPLOAD_IMAGE_AS_ICON : getRuntimeEnvFromBody('NEXT_PUBLIC_DISABLE_UPLOAD_IMAGE_AS_ICON'),
    NEXT_PUBLIC_EDITION: isServer ? process.env.NEXT_PUBLIC_EDITION : getRuntimeEnvFromBody('NEXT_PUBLIC_EDITION'),
    NEXT_PUBLIC_ENABLE_SINGLE_DOLLAR_LATEX: isServer ? process.env.NEXT_PUBLIC_ENABLE_SINGLE_DOLLAR_LATEX : getRuntimeEnvFromBody('NEXT_PUBLIC_ENABLE_SINGLE_DOLLAR_LATEX'),
    NEXT_PUBLIC_ENABLE_WEBSITE_FIRECRAWL: isServer ? process.env.NEXT_PUBLIC_ENABLE_WEBSITE_FIRECRAWL : getRuntimeEnvFromBody('NEXT_PUBLIC_ENABLE_WEBSITE_FIRECRAWL'),
    NEXT_PUBLIC_ENABLE_WEBSITE_JINAREADER: isServer ? process.env.NEXT_PUBLIC_ENABLE_WEBSITE_JINAREADER : getRuntimeEnvFromBody('NEXT_PUBLIC_ENABLE_WEBSITE_JINAREADER'),
    NEXT_PUBLIC_ENABLE_WEBSITE_WATERCRAWL: isServer ? process.env.NEXT_PUBLIC_ENABLE_WEBSITE_WATERCRAWL : getRuntimeEnvFromBody('NEXT_PUBLIC_ENABLE_WEBSITE_WATERCRAWL'),
    NEXT_PUBLIC_GITHUB_ACCESS_TOKEN: isServer ? process.env.NEXT_PUBLIC_GITHUB_ACCESS_TOKEN : getRuntimeEnvFromBody('NEXT_PUBLIC_GITHUB_ACCESS_TOKEN'),
    NEXT_PUBLIC_INDEXING_MAX_SEGMENTATION_TOKENS_LENGTH: isServer ? process.env.NEXT_PUBLIC_INDEXING_MAX_SEGMENTATION_TOKENS_LENGTH : getRuntimeEnvFromBody('NEXT_PUBLIC_INDEXING_MAX_SEGMENTATION_TOKENS_LENGTH'),
    NEXT_PUBLIC_IS_MARKETPLACE: isServer ? process.env.NEXT_PUBLIC_IS_MARKETPLACE : getRuntimeEnvFromBody('NEXT_PUBLIC_IS_MARKETPLACE'),
    NEXT_PUBLIC_LOOP_NODE_MAX_COUNT: isServer ? process.env.NEXT_PUBLIC_LOOP_NODE_MAX_COUNT : getRuntimeEnvFromBody('NEXT_PUBLIC_LOOP_NODE_MAX_COUNT'),
    NEXT_PUBLIC_MAINTENANCE_NOTICE: isServer ? process.env.NEXT_PUBLIC_MAINTENANCE_NOTICE : getRuntimeEnvFromBody('NEXT_PUBLIC_MAINTENANCE_NOTICE'),
    NEXT_PUBLIC_MARKETPLACE_API_PREFIX: isServer ? process.env.NEXT_PUBLIC_MARKETPLACE_API_PREFIX : getRuntimeEnvFromBody('NEXT_PUBLIC_MARKETPLACE_API_PREFIX'),
    NEXT_PUBLIC_MARKETPLACE_URL_PREFIX: isServer ? process.env.NEXT_PUBLIC_MARKETPLACE_URL_PREFIX : getRuntimeEnvFromBody('NEXT_PUBLIC_MARKETPLACE_URL_PREFIX'),
    NEXT_PUBLIC_MAX_ITERATIONS_NUM: isServer ? process.env.NEXT_PUBLIC_MAX_ITERATIONS_NUM : getRuntimeEnvFromBody('NEXT_PUBLIC_MAX_ITERATIONS_NUM'),
    NEXT_PUBLIC_MAX_PARALLEL_LIMIT: isServer ? process.env.NEXT_PUBLIC_MAX_PARALLEL_LIMIT : getRuntimeEnvFromBody('NEXT_PUBLIC_MAX_PARALLEL_LIMIT'),
    NEXT_PUBLIC_MAX_TOOLS_NUM: isServer ? process.env.NEXT_PUBLIC_MAX_TOOLS_NUM : getRuntimeEnvFromBody('NEXT_PUBLIC_MAX_TOOLS_NUM'),
    NEXT_PUBLIC_MAX_TREE_DEPTH: isServer ? process.env.NEXT_PUBLIC_MAX_TREE_DEPTH : getRuntimeEnvFromBody('NEXT_PUBLIC_MAX_TREE_DEPTH'),
    NEXT_PUBLIC_PUBLIC_API_PREFIX: isServer ? process.env.NEXT_PUBLIC_PUBLIC_API_PREFIX : getRuntimeEnvFromBody('NEXT_PUBLIC_PUBLIC_API_PREFIX'),
    NEXT_PUBLIC_SENTRY_DSN: isServer ? process.env.NEXT_PUBLIC_SENTRY_DSN : getRuntimeEnvFromBody('NEXT_PUBLIC_SENTRY_DSN'),
    NEXT_PUBLIC_SITE_ABOUT: isServer ? process.env.NEXT_PUBLIC_SITE_ABOUT : getRuntimeEnvFromBody('NEXT_PUBLIC_SITE_ABOUT'),
    NEXT_PUBLIC_SUPPORT_MAIL_LOGIN: isServer ? process.env.NEXT_PUBLIC_SUPPORT_MAIL_LOGIN : getRuntimeEnvFromBody('NEXT_PUBLIC_SUPPORT_MAIL_LOGIN'),
    NEXT_PUBLIC_TEXT_GENERATION_TIMEOUT_MS: isServer ? process.env.NEXT_PUBLIC_TEXT_GENERATION_TIMEOUT_MS : getRuntimeEnvFromBody('NEXT_PUBLIC_TEXT_GENERATION_TIMEOUT_MS'),
    NEXT_PUBLIC_TOP_K_MAX_VALUE: isServer ? process.env.NEXT_PUBLIC_TOP_K_MAX_VALUE : getRuntimeEnvFromBody('NEXT_PUBLIC_TOP_K_MAX_VALUE'),
    NEXT_PUBLIC_UPLOAD_IMAGE_AS_ICON: isServer ? process.env.NEXT_PUBLIC_UPLOAD_IMAGE_AS_ICON : getRuntimeEnvFromBody('NEXT_PUBLIC_UPLOAD_IMAGE_AS_ICON'),
    NEXT_PUBLIC_WEB_PREFIX: isServer ? process.env.NEXT_PUBLIC_WEB_PREFIX : getRuntimeEnvFromBody('NEXT_PUBLIC_WEB_PREFIX'),
    NEXT_PUBLIC_ZENDESK_FIELD_ID_EMAIL: isServer ? process.env.NEXT_PUBLIC_ZENDESK_FIELD_ID_EMAIL : getRuntimeEnvFromBody('NEXT_PUBLIC_ZENDESK_FIELD_ID_EMAIL'),
    NEXT_PUBLIC_ZENDESK_FIELD_ID_ENVIRONMENT: isServer ? process.env.NEXT_PUBLIC_ZENDESK_FIELD_ID_ENVIRONMENT : getRuntimeEnvFromBody('NEXT_PUBLIC_ZENDESK_FIELD_ID_ENVIRONMENT'),
    NEXT_PUBLIC_ZENDESK_FIELD_ID_PLAN: isServer ? process.env.NEXT_PUBLIC_ZENDESK_FIELD_ID_PLAN : getRuntimeEnvFromBody('NEXT_PUBLIC_ZENDESK_FIELD_ID_PLAN'),
    NEXT_PUBLIC_ZENDESK_FIELD_ID_VERSION: isServer ? process.env.NEXT_PUBLIC_ZENDESK_FIELD_ID_VERSION : getRuntimeEnvFromBody('NEXT_PUBLIC_ZENDESK_FIELD_ID_VERSION'),
    NEXT_PUBLIC_ZENDESK_FIELD_ID_WORKSPACE_ID: isServer ? process.env.NEXT_PUBLIC_ZENDESK_FIELD_ID_WORKSPACE_ID : getRuntimeEnvFromBody('NEXT_PUBLIC_ZENDESK_FIELD_ID_WORKSPACE_ID'),
    NEXT_PUBLIC_ZENDESK_WIDGET_KEY: isServer ? process.env.NEXT_PUBLIC_ZENDESK_WIDGET_KEY : getRuntimeEnvFromBody('NEXT_PUBLIC_ZENDESK_WIDGET_KEY'),
  },
  emptyStringAsUndefined: true,
})

function getDatasetAttrKeyFromEnvKey<K extends ClientEnvKey>(key: K) {
  const suffix = kebabCase(replace(key, CLIENT_ENV_PREFIX, ''))
  return `data-${suffix}` as const
}

export function getDatasetMap() {
  const clientEnvKeys = Object.keys(clientSchema) as ReadonlyArray<ClientEnvKey>
  return Object.fromEntries(clientEnvKeys.map(envKey => [getDatasetAttrKeyFromEnvKey(envKey), env[envKey]]))
}
