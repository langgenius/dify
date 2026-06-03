import type { ConfigFile } from '@/config/schema'
import type { YamlStore } from '@/store/store'
import { loadConfig } from '@/config/config-loader'
import { unsetKey } from '@/config/keys'
import { emptyConfig } from '@/config/schema'
import { saveConfig } from '@/store/config-writer'

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
