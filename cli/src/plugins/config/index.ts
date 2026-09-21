import type { Printable } from '@/plugins/io'
import { join } from 'node:path'
import { z } from 'zod'
import { BaseError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { definePlugin } from '@/kernel/plugin'
import { env } from '@/plugins/env'
import { YamlStore } from '@/store/store'
import { isRecord } from '@/util/is-record'

export const CONFIG_FILE_NAME = 'config.yml'
export const CONFIG_SCHEMA_VERSION = 1

export const CONFIG_SCHEMA = z
  .object({
    schema_version: z.literal(1).default(1),
    http: z.object({ timeout: z.number().int().positive().default(30_000) }).prefault({}),
  })
  .strict()

export type ConfigDoc = z.infer<typeof CONFIG_SCHEMA>

export const CONFIG_KEYS = ['http.timeout'] as const
export type ConfigKey = (typeof CONFIG_KEYS)[number]

export type ConfigService = {
  readonly path: string
  readonly doc: () => Promise<ConfigDoc>
  readonly get: (key?: string) => Promise<Printable | undefined>
  readonly set: (key: string, raw: string) => Promise<void>
  readonly unset: (key: string) => Promise<void>
}

function isConfigKey(key: string): key is ConfigKey {
  return (CONFIG_KEYS as readonly string[]).includes(key)
}

function requireConfigKey(key: string): ConfigKey {
  if (!isConfigKey(key)) {
    throw new BaseError({
      code: ErrorCode.ConfigInvalidKey,
      message: `unknown config key "${key}"`,
      hint: `known keys: ${CONFIG_KEYS.join(', ')}`,
    })
  }
  return key
}

function readPath(doc: ConfigDoc, dotted: string): Printable | undefined {
  return dotted.split('.').reduce<unknown>((acc, part) => {
    return isRecord(acc) ? acc[part] : undefined
  }, doc) as Printable | undefined
}

function writePath(target: Record<string, unknown>, dotted: string, value: unknown): void {
  const parts = dotted.split('.')
  const lastKey = parts.pop() as string
  let current = target
  for (const part of parts) {
    const next = current[part]
    if (next === null || typeof next !== 'object') current[part] = {}
    current = current[part] as Record<string, unknown>
  }
  current[lastKey] = value
}

function deletePath(target: Record<string, unknown>, dotted: string): void {
  const parts = dotted.split('.')
  const lastKey = parts.pop() as string
  let current: Record<string, unknown> = target
  for (const part of parts) {
    const next = current[part]
    if (next === null || typeof next !== 'object') return
    current = next as Record<string, unknown>
  }
  delete current[lastKey]
}

function parseRawValue(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

function checkSchemaVersion(raw: unknown): void {
  if (!isRecord(raw)) return
  const version = raw.schema_version
  if (typeof version === 'number' && version > CONFIG_SCHEMA_VERSION) {
    throw new BaseError({
      code: ErrorCode.ConfigSchemaUnsupported,
      message: `config schema_version ${version} is newer than the supported version ${CONFIG_SCHEMA_VERSION}`,
      hint: 'upgrade difyctl to read this config file',
    })
  }
}

function validateDoc(raw: unknown): ConfigDoc {
  checkSchemaVersion(raw)
  const result = CONFIG_SCHEMA.safeParse(raw)
  if (!result.success) {
    throw new BaseError({
      code: ErrorCode.ConfigInvalidValue,
      message: result.error.issues.map((issue) => issue.message).join('; '),
    })
  }
  return result.data
}

export const config = definePlugin({
  name: 'config',
  needs: [env],
  build: async (ctx): Promise<ConfigService> => {
    const { configDir } = await ctx.get(env)
    const path = join(configDir, CONFIG_FILE_NAME)
    const store = new YamlStore(path)

    let cached: ConfigDoc | undefined

    async function doc(): Promise<ConfigDoc> {
      if (cached === undefined) {
        const raw = await store.getTyped<Record<string, unknown>>()
        cached = validateDoc(raw ?? {})
      }
      return cached
    }

    async function persist(mutate: (target: Record<string, unknown>) => void): Promise<void> {
      const current = structuredClone(await doc()) as Record<string, unknown>
      mutate(current)
      const validated = validateDoc(current)
      await store.setTyped(validated)
      cached = validated
    }

    return {
      path,
      doc,
      get: async (key?: string) => {
        const current = await doc()
        if (key === undefined) return { ...current, path }
        return readPath(current, requireConfigKey(key))
      },
      set: async (key: string, raw: string) => {
        const configKey = requireConfigKey(key)
        const value = parseRawValue(raw)
        await persist((target) => writePath(target, configKey, value))
      },
      unset: async (key: string) => {
        const configKey = requireConfigKey(key)
        await persist((target) => deletePath(target, configKey))
      },
    }
  },
})
