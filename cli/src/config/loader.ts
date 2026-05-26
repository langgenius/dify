import type { ConfigFile } from './schema.js'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { load as parseYaml } from 'js-yaml'
import { newError } from '../errors/base.js'
import { ErrorCode } from '../errors/codes.js'
import {

  ConfigFileSchema,
  CURRENT_SCHEMA_VERSION,
  FILE_NAME,
} from './schema.js'

export type LoadResult
  = | { found: false }
    | { found: true, config: ConfigFile }

export async function loadConfig(dir: string): Promise<LoadResult> {
  const path = join(dir, FILE_NAME)
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT')
      return { found: false }
    throw newError(ErrorCode.Unknown, `read ${path}: ${(err as Error).message}`)
      .wrap(err)
  }

  let parsed: unknown
  try {
    parsed = parseYaml(raw)
  }
  catch (err) {
    throw newError(
      ErrorCode.ConfigSchemaUnsupported,
      `parse ${path}: ${(err as Error).message}`,
    ).wrap(err).withHint('config.yml is not valid YAML')
  }

  const result = ConfigFileSchema.safeParse(parsed ?? {})
  if (!result.success) {
    throw newError(
      ErrorCode.ConfigSchemaUnsupported,
      `validate ${path}: ${result.error.issues.map(i => i.message).join('; ')}`,
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
