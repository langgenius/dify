import type { ConfigFile } from '@/config/schema'
import type { YamlStore } from '@/store/store'
import { loadConfig } from '@/config/config-loader'
import { getKey } from '@/config/keys'
import { emptyConfig } from '@/config/schema'

export type RunConfigGetOptions = {
  readonly key: string
  readonly store: YamlStore
}

export function runConfigGet(opts: RunConfigGetOptions): string {
  const loaded = loadConfig(opts.store)
  const config: ConfigFile = loaded.found ? loaded.config : emptyConfig()
  return `${getKey(config, opts.key)}\n`
}
