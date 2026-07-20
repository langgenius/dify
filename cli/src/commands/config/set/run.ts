import type { ConfigFile } from '@/config/schema'
import type { YamlStore } from '@/store/store'
import { loadConfig } from '@/config/config-loader'
import { setKey } from '@/config/keys'
import { emptyConfig } from '@/config/schema'
import { saveConfig } from '@/store/config-writer'

export type RunConfigSetOptions = {
  readonly key: string
  readonly value: string
  readonly store: YamlStore
}

export async function runConfigSet(opts: RunConfigSetOptions): Promise<string> {
  const loaded = await loadConfig(opts.store)
  const config: ConfigFile = loaded.found ? loaded.config : emptyConfig()
  const next = setKey(config, opts.key, opts.value)
  await saveConfig(opts.store, next)
  return `set ${opts.key} = ${opts.value}\n`
}
