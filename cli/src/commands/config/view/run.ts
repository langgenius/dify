import type { ConfigFile } from '@/config/schema'
import type { YamlStore } from '@/store/store'
import { loadConfig } from '@/config/config-loader'
import { knownKeyNames, lookupKey } from '@/config/keys'
import { emptyConfig } from '@/config/schema'

export type RunConfigViewOptions = {
  readonly json?: boolean
  readonly store: YamlStore
}

type ViewOut = Record<string, number | string>

export async function runConfigView(opts: RunConfigViewOptions): Promise<string> {
  const loaded = await loadConfig(opts.store)
  const config: ConfigFile = loaded.found ? loaded.config : emptyConfig()
  const out = collect(config)
  if (opts.json)
    return `${JSON.stringify(out, null, 2)}\n`
  let text = ''
  for (const k of knownKeyNames()) {
    if (!(k in out))
      continue
    text += `${k} = ${out[k]}\n`
  }
  return text
}

function collect(config: ConfigFile): ViewOut {
  const out: ViewOut = {}
  for (const k of knownKeyNames()) {
    const spec = lookupKey(k)
    if (spec === undefined)
      continue
    const v = spec.get(config)
    if (v === '')
      continue
    if (k === 'defaults.limit') {
      const n = Number.parseInt(v, 10)
      if (Number.isFinite(n))
        out[k] = n
      continue
    }
    out[k] = v
  }
  return out
}
