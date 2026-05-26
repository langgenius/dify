import type { ConfigFile } from '../../../config/schema.js'
import type { YamlStore } from '../../../store/store.js'
import { loadConfig } from '../../../config/config-loader.js'
import { unsetKey } from '../../../config/keys.js'
import { emptyConfig } from '../../../config/schema.js'
import { saveConfig } from '../../../store/config-writer.js'

export type RunConfigUnsetOptions = {
  readonly key: string
  readonly store: YamlStore
}

export function runConfigUnset(opts: RunConfigUnsetOptions): string {
  const loaded = loadConfig(opts.store)
  const config: ConfigFile = loaded.found ? loaded.config : emptyConfig()
  const next = unsetKey(config, opts.key)
  saveConfig(opts.store, next)
  return `unset ${opts.key}\n`
}
