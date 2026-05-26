import type { ConfigFile } from '../../../config/schema.js'
import type { YamlStore } from '../../../store/store.js'
import { loadConfig } from '../../../config/config-loader.js'
import { setKey } from '../../../config/keys.js'
import { emptyConfig } from '../../../config/schema.js'
import { saveConfig } from '../../../store/config-writer.js'

export type RunConfigSetOptions = {
  readonly key: string
  readonly value: string
  readonly store: YamlStore
}

export function runConfigSet(opts: RunConfigSetOptions): string {
  const loaded = loadConfig(opts.store)
  const config: ConfigFile = loaded.found ? loaded.config : emptyConfig()
  const next = setKey(config, opts.key, opts.value)
  saveConfig(opts.store, next)
  return `set ${opts.key} = ${opts.value}\n`
}
