import type { ConfigFile } from '../../../config/schema.js'
import { unsetKey } from '../../../config/keys.js'
import { loadConfig } from '../../../config/loader.js'
import { emptyConfig } from '../../../config/schema.js'
import { saveConfig } from '../../../config/writer.js'

export type RunConfigUnsetOptions = {
  readonly key: string
  readonly dir: string
}

export async function runConfigUnset(opts: RunConfigUnsetOptions): Promise<string> {
  const loaded = await loadConfig(opts.dir)
  const config: ConfigFile = loaded.found ? loaded.config : emptyConfig()
  const next = unsetKey(config, opts.key)
  await saveConfig(opts.dir, next)
  return `unset ${opts.key}\n`
}
