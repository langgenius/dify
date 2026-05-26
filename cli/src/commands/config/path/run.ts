import { join } from 'node:path'
import { FILE_NAME } from '../../../config/schema.js'

export type RunConfigPathOptions = {
  readonly dir: string
}

export function runConfigPath(opts: RunConfigPathOptions): string {
  return `${join(opts.dir, FILE_NAME)}\n`
}
