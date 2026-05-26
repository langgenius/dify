import type { ConfigFile } from '../../../config/schema.js'
import { setKey } from '../../../config/keys.js'
import { loadConfig } from '../../../config/loader.js'
import { emptyConfig } from '../../../config/schema.js'
import { saveConfig } from '../../../config/writer.js'

export type RunConfigSetOptions = {
  readonly key: string
  readonly value: string
  readonly dir: string
}

export async function runConfigSet(opts: RunConfigSetOptions): Promise<string> {
  const loaded = await loadConfig(opts.dir)
  const config: ConfigFile = loaded.found ? loaded.config : emptyConfig()
  const next = setKey(config, opts.key, opts.value)
  await saveConfig(opts.dir, next)
  return `set ${opts.key} = ${opts.value}\n`
}
