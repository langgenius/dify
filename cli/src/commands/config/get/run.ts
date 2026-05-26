import type { ConfigFile } from '../../../config/schema.js'
import type { YamlStore } from '../../../store/store.js'
import { loadConfig } from '../../../config/config-loader.js'
import { getKey } from '../../../config/keys.js'
import { emptyConfig } from '../../../config/schema.js'

export type RunConfigGetOptions = {
  readonly key: string
  readonly store: YamlStore
}

export function runConfigGet(opts: RunConfigGetOptions): string {
  const loaded = loadConfig(opts.store)
  const config: ConfigFile = loaded.found ? loaded.config : emptyConfig()
  return `${getKey(config, opts.key)}\n`
}
