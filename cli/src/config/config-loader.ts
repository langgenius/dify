import type { ConfigFile } from './schema'
import type { YamlStore } from '@/store/store'
import { newError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { ConfigFileSchema, CURRENT_SCHEMA_VERSION } from './schema'

export type LoadResult = { found: false } | { found: true; config: ConfigFile }

export async function loadConfig(store: YamlStore): Promise<LoadResult> {
  let raw: Record<string, unknown> | null
  try {
    raw = await store.getTyped<Record<string, unknown>>()
  } catch (err) {
    throw newError(ErrorCode.ConfigSchemaUnsupported, `parse config.yml: ${(err as Error).message}`)
      .wrap(err)
      .withHint('config.yml is not valid YAML')
  }

  if (raw === null) return { found: false }

  const result = ConfigFileSchema.safeParse(raw)
  if (!result.success) {
    throw newError(
      ErrorCode.ConfigSchemaUnsupported,
      `validate config.yml: ${result.error.issues.map((i) => i.message).join('; ')}`,
    ).withHint('config.yml does not match the v1 schema')
  }

  if (result.data.schema_version > CURRENT_SCHEMA_VERSION) {
    throw newError(
      ErrorCode.ConfigSchemaUnsupported,
      `config.yml schema_version=${result.data.schema_version} is newer than this binary supports (max=${CURRENT_SCHEMA_VERSION})`,
    ).withHint('upgrade difyctl, or remove config.yml')
  }

  return { found: true, config: result.data }
}
