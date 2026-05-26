import type { ConfigFile } from '../../../config/schema.js'
import { getKey } from '../../../config/keys.js'
import { loadConfig } from '../../../config/loader.js'
import { emptyConfig } from '../../../config/schema.js'

export type RunConfigGetOptions = {
  readonly key: string
  readonly dir: string
}

export async function runConfigGet(opts: RunConfigGetOptions): Promise<string> {
  const loaded = await loadConfig(opts.dir)
  const config: ConfigFile = loaded.found ? loaded.config : emptyConfig()
  return `${getKey(config, opts.key)}\n`
}
