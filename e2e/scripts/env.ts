import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { createEnv } from '@t3-oss/env-core'
import * as z from 'zod'
import { e2eDir } from './common'

const booleanString = z.enum(['0', '1', 'false', 'true'])
const jsonObjectString = z.string().refine((value) => {
  try {
    const parsed = JSON.parse(value) as unknown
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
  }
  catch {
    return false
  }
}, 'must be a JSON object string')

const parseEnvLine = (line: string) => {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#'))
    return undefined

  const normalized = trimmed.startsWith('export ')
    ? trimmed.slice('export '.length).trim()
    : trimmed
  const separatorIndex = normalized.indexOf('=')
  if (separatorIndex === -1)
    return undefined

  const key = normalized.slice(0, separatorIndex).trim()
  let value = normalized.slice(separatorIndex + 1).trim()
  if (!key)
    return undefined

  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith('\'') && value.endsWith('\''))
  ) {
    value = value.slice(1, -1)
  }

  return [key, value] as const
}

export const loadE2eEnv = () => {
  const envFilePath = process.env.E2E_ENV_FILE
    ? path.resolve(process.env.E2E_ENV_FILE)
    : path.join(e2eDir, '.env.local')

  if (!existsSync(envFilePath))
    return

  const content = readFileSync(envFilePath, 'utf8')
  for (const line of content.split(/\r?\n/)) {
    const entry = parseEnvLine(line)
    if (!entry)
      continue

    const [key, value] = entry
    process.env[key] ??= value
  }
}

export const validateE2eEnv = () => createEnv({
  client: {},
  clientPrefix: 'NEXT_PUBLIC_',
  emptyStringAsUndefined: true,
  onValidationError: (issues) => {
    const messages = issues.map((issue) => {
      const path = Array.isArray(issue.path) && issue.path.length > 0
        ? issue.path.join('.')
        : '(root)'
      return `- ${path}: ${issue.message}`
    })

    throw new Error(`Invalid E2E env:\n${messages.join('\n')}`)
  },
  runtimeEnv: {
    CUCUMBER_HEADLESS: process.env.CUCUMBER_HEADLESS,
    E2E_ADMIN_EMAIL: process.env.E2E_ADMIN_EMAIL,
    E2E_ADMIN_NAME: process.env.E2E_ADMIN_NAME,
    E2E_ADMIN_PASSWORD: process.env.E2E_ADMIN_PASSWORD,
    E2E_API_URL: process.env.E2E_API_URL,
    E2E_BASE_URL: process.env.E2E_BASE_URL,
    E2E_BROKEN_MODEL_NAME: process.env.E2E_BROKEN_MODEL_NAME,
    E2E_BROKEN_MODEL_PROVIDER: process.env.E2E_BROKEN_MODEL_PROVIDER,
    E2E_BROKEN_MODEL_TYPE: process.env.E2E_BROKEN_MODEL_TYPE,
    E2E_CUCUMBER_TAGS: process.env.E2E_CUCUMBER_TAGS,
    E2E_FORCE_WEB_BUILD: process.env.E2E_FORCE_WEB_BUILD,
    E2E_INIT_PASSWORD: process.env.E2E_INIT_PASSWORD,
    E2E_MARKETPLACE_API_URL: process.env.E2E_MARKETPLACE_API_URL,
    E2E_MARKETPLACE_PLUGIN_IDS: process.env.E2E_MARKETPLACE_PLUGIN_IDS,
    E2E_MARKETPLACE_PLUGIN_UNIQUE_IDENTIFIERS: process.env.E2E_MARKETPLACE_PLUGIN_UNIQUE_IDENTIFIERS,
    E2E_MODEL_PROVIDER_CREDENTIALS_JSON: process.env.E2E_MODEL_PROVIDER_CREDENTIALS_JSON,
    E2E_OAUTH_TOOL_CREDENTIAL_ID: process.env.E2E_OAUTH_TOOL_CREDENTIAL_ID,
    E2E_OAUTH_TOOL_NAME: process.env.E2E_OAUTH_TOOL_NAME,
    E2E_OAUTH_TOOL_PROVIDER: process.env.E2E_OAUTH_TOOL_PROVIDER,
    E2E_REUSE_WEB_SERVER: process.env.E2E_REUSE_WEB_SERVER,
    E2E_SLOW_MO: process.env.E2E_SLOW_MO,
    E2E_STABLE_MODEL_NAME: process.env.E2E_STABLE_MODEL_NAME,
    E2E_STABLE_MODEL_PROVIDER: process.env.E2E_STABLE_MODEL_PROVIDER,
    E2E_STABLE_MODEL_TYPE: process.env.E2E_STABLE_MODEL_TYPE,
  },
  server: {
    CUCUMBER_HEADLESS: booleanString.optional(),
    E2E_ADMIN_EMAIL: z.email().optional(),
    E2E_ADMIN_NAME: z.string().min(1).optional(),
    E2E_ADMIN_PASSWORD: z.string().min(1).optional(),
    E2E_API_URL: z.url().optional(),
    E2E_BASE_URL: z.url().optional(),
    E2E_BROKEN_MODEL_NAME: z.string().min(1).optional(),
    E2E_BROKEN_MODEL_PROVIDER: z.string().min(1).optional(),
    E2E_BROKEN_MODEL_TYPE: z.string().min(1).optional(),
    E2E_CUCUMBER_TAGS: z.string().min(1).optional(),
    E2E_FORCE_WEB_BUILD: z.literal('1').optional(),
    E2E_INIT_PASSWORD: z.string().min(1).optional(),
    E2E_MARKETPLACE_API_URL: z.url().optional(),
    E2E_MARKETPLACE_PLUGIN_IDS: z.string().min(1).optional(),
    E2E_MARKETPLACE_PLUGIN_UNIQUE_IDENTIFIERS: z.string().min(1).optional(),
    E2E_MODEL_PROVIDER_CREDENTIALS_JSON: jsonObjectString.optional(),
    E2E_OAUTH_TOOL_CREDENTIAL_ID: z.string().min(1).optional(),
    E2E_OAUTH_TOOL_NAME: z.string().min(1).optional(),
    E2E_OAUTH_TOOL_PROVIDER: z.string().min(1).optional(),
    E2E_REUSE_WEB_SERVER: booleanString.optional(),
    E2E_SLOW_MO: z.coerce.number().nonnegative().optional(),
    E2E_STABLE_MODEL_NAME: z.string().min(1).optional(),
    E2E_STABLE_MODEL_PROVIDER: z.string().min(1).optional(),
    E2E_STABLE_MODEL_TYPE: z.string().min(1).optional(),
  },
})
