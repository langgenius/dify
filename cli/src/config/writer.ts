import type { ConfigFile } from './schema.js'
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dump as dumpYaml } from 'js-yaml'
import { newError } from '../errors/base.js'
import { ErrorCode } from '../errors/codes.js'
import { DIR_PERM, FILE_PERM } from './dir.js'
import {

  CURRENT_SCHEMA_VERSION,
  FILE_NAME,
} from './schema.js'

export async function saveConfig(dir: string, config: ConfigFile): Promise<void> {
  await mkdir(dir, { recursive: true, mode: DIR_PERM })

  const stamped: ConfigFile = { ...config, schema_version: CURRENT_SCHEMA_VERSION }
  const yaml = dumpYaml(stamped, { lineWidth: -1, noRefs: true })

  const target = join(dir, FILE_NAME)
  const tmp = `${target}.tmp.${process.pid}.${Date.now()}`

  try {
    await writeFile(tmp, yaml, { mode: FILE_PERM })
    await rename(tmp, target)
  }
  catch (err) {
    try {
      await unlink(tmp)
    }
    catch {
      // tmp may not exist if writeFile failed before creating it
    }
    throw newError(
      ErrorCode.Unknown,
      `save ${target}: ${(err as Error).message}`,
    ).wrap(err)
  }
}
