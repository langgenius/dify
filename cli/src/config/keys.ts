import type { AllowedFormat, ConfigFile } from './schema.js'
import { newError } from '../errors/base.js'
import { ErrorCode } from '../errors/codes.js'
import { parseLimit } from '../limit/limit.js'
import { ALLOWED_FORMATS } from './schema.js'

export type KeySpec = {
  readonly name: string
  readonly description: string
  get: (config: ConfigFile) => string
  set: (config: ConfigFile, value: string) => ConfigFile
  unset: (config: ConfigFile) => ConfigFile
}

const KEYS: readonly KeySpec[] = [
  {
    name: 'defaults.format',
    description: `Default output format used when -o is not passed (${ALLOWED_FORMATS.join('|')}).`,
    get: c => c.defaults.format ?? '',
    set: (c, v) => {
      if (!(ALLOWED_FORMATS as readonly string[]).includes(v)) {
        throw newError(
          ErrorCode.ConfigInvalidValue,
          `defaults.format: ${JSON.stringify(v)} is not one of ${ALLOWED_FORMATS.join('|')}`,
        )
      }
      return { ...c, defaults: { ...c.defaults, format: v as AllowedFormat } }
    },
    unset: c => ({ ...c, defaults: { ...c.defaults, format: undefined } }),
  },
  {
    name: 'defaults.limit',
    description: 'Default page size for list commands (1..200).',
    get: c => (c.defaults.limit === undefined ? '' : String(c.defaults.limit)),
    set: (c, v) => {
      try {
        const n = parseLimit(v, 'defaults.limit')
        return { ...c, defaults: { ...c.defaults, limit: n } }
      }
      catch (err) {
        throw newError(ErrorCode.ConfigInvalidValue, (err as Error).message).wrap(err)
      }
    },
    unset: c => ({ ...c, defaults: { ...c.defaults, limit: undefined } }),
  },
  {
    name: 'state.current_app',
    description: 'App ID used when commands need an app context but no positional argument is given.',
    get: c => c.state.current_app ?? '',
    set: (c, v) => ({ ...c, state: { ...c.state, current_app: v } }),
    unset: c => ({ ...c, state: { ...c.state, current_app: undefined } }),
  },
]

const SORTED: readonly KeySpec[] = [...KEYS].sort((a, b) => a.name.localeCompare(b.name))
const BY_NAME = new Map(SORTED.map(k => [k.name, k]))

export function knownKeys(): readonly KeySpec[] {
  return SORTED
}

export function knownKeyNames(): readonly string[] {
  return SORTED.map(k => k.name)
}

export function lookupKey(name: string): KeySpec | undefined {
  return BY_NAME.get(name)
}

export function getKey(config: ConfigFile, name: string): string {
  const spec = lookupKey(name)
  if (spec === undefined)
    throw unknownKey(name)
  return spec.get(config)
}

export function setKey(config: ConfigFile, name: string, value: string): ConfigFile {
  const spec = lookupKey(name)
  if (spec === undefined)
    throw unknownKey(name)
  return spec.set(config, value)
}

export function unsetKey(config: ConfigFile, name: string): ConfigFile {
  const spec = lookupKey(name)
  if (spec === undefined)
    throw unknownKey(name)
  return spec.unset(config)
}

function unknownKey(name: string): Error {
  return newError(
    ErrorCode.ConfigInvalidKey,
    `unknown config key ${JSON.stringify(name)} (known: ${knownKeyNames().join(', ')})`,
  )
}
