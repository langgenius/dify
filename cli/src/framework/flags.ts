import type { ArgDefinition, CommandMeta, FlagDefinition, ParsedArgs, ParsedFlags } from './types'
import { UnsupportedArgValueError } from './errors'

function stringFlag<const Opts extends {
  description: string
  char?: string
  default?: string
  options?: readonly string[]
}>(
  opts: Opts,
): FlagDefinition<string> {
  return {
    type: 'string',
    multiple: false,
    ...opts,
  }
}

function outputFormatFlag<const Opts extends { options: readonly string[], default?: string }>(
  opts: Opts,
): FlagDefinition<string> {
  return {
    type: 'string',
    description: `output format (${opts.options.join('|')})`,
    char: 'o',
    multiple: false,
    ...opts,
  }
}

function stringRepeatedFlag<const Opts extends { description: string, char?: string, default?: string[], multiple?: boolean }>(
  opts: Opts,
): FlagDefinition<string[]> {
  return {
    type: 'string',
    multiple: true,
    ...opts,
  }
}

function booleanFlag(opts: { description: string, char?: string, default?: boolean }): FlagDefinition<boolean> {
  return { type: 'boolean', ...opts }
}

function integerFlag<const Opts extends { description: string, char?: string, default?: number }>(
  opts: Opts,
): FlagDefinition<Opts extends { default: number } ? number : number | undefined> {
  return { type: 'integer', ...opts } as FlagDefinition<Opts extends { default: number } ? number : number | undefined>
}

export const Flags = {
  string: stringFlag,
  stringArray: stringRepeatedFlag,
  boolean: booleanFlag,
  integer: integerFlag,
  outputFormat: outputFormatFlag,
}

function stringArg<const Opts extends { description: string, required?: boolean }>(
  opts: Opts,
): ArgDefinition<Opts extends { required: true } ? string : string | undefined> {
  return opts as ArgDefinition<Opts extends { required: true } ? string : string | undefined>
}

export const Args = {
  string: stringArg,
}

function coerceFlagValue(raw: string, def: FlagDefinition): string | boolean | number {
  switch (def.type) {
    case 'integer': {
      const n = Number(raw)
      if (Number.isNaN(n))
        throw new Error(`expected integer, got ${JSON.stringify(raw)}`)

      return n
    }
    case 'boolean': {
      if (raw === 'true' || raw === '1')
        return true

      if (raw === 'false' || raw === '0')
        return false

      throw new Error(`expected boolean, got ${JSON.stringify(raw)}`)
    }
    default:
      return raw
  }
}

function accumulateFlagValue(flags: ParsedFlags, name: string, value: string | boolean | number, def: FlagDefinition): void {
  if (def.multiple === true) {
    const existing = flags[name]
    flags[name] = Array.isArray(existing) ? [...existing, String(value)] : [String(value)]
  }
  else {
    flags[name] = value
  }
}

function resolveByChar(char: string, meta: CommandMeta): [name: string, def: FlagDefinition] | undefined {
  for (const [name, def] of Object.entries(meta.flags)) {
    if (def.char === char)
      return [name, def]
  }

  return undefined
}

function validateFlagOptions(name: string, raw: string, def: FlagDefinition): void {
  if (def.options !== undefined && !def.options.includes(raw))
    throw new UnsupportedArgValueError(name, def, raw)
}

type ResolvedFlag = { name: string, def: FlagDefinition, label: string, inlineRaw: string | undefined }

function resolveToken(token: string, meta: CommandMeta): ResolvedFlag | null {
  if (token.startsWith('--')) {
    const eqIdx = token.indexOf('=')
    const name = eqIdx !== -1 ? token.slice(2, eqIdx) : token.slice(2)
    const inlineRaw = eqIdx !== -1 ? token.slice(eqIdx + 1) : undefined
    const def = meta.flags[name]
    if (!def)
      throw new Error(`unknown flag: --${name}`)
    return { name, def, label: `--${name}`, inlineRaw }
  }

  if (token.length === 2 && token[1] !== undefined) {
    const char = token[1]
    const resolved = resolveByChar(char, meta)
    if (!resolved)
      throw new Error(`unknown flag: -${char}`)
    const [name, def] = resolved
    return { name, def, label: `-${char}`, inlineRaw: undefined }
  }

  return null
}

export function parseArgv(argv: readonly string[], meta: CommandMeta): { args: ParsedArgs, flags: ParsedFlags } {
  const flags: ParsedFlags = {}
  const positional: string[] = []
  const argDefs = Object.entries(meta.args)
  let pastDoubleDash = false

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (token === undefined)
      break

    if (!pastDoubleDash && token === '--') {
      pastDoubleDash = true
      continue
    }

    if (pastDoubleDash || !token.startsWith('-')) {
      positional.push(token)
      continue
    }

    const resolved = resolveToken(token, meta)
    if (!resolved) {
      positional.push(token)
      continue
    }

    const { name, def, label, inlineRaw } = resolved

    if (def.type === 'boolean') {
      flags[name] = inlineRaw === undefined ? true : coerceFlagValue(inlineRaw, def)
      continue
    }

    let raw: string
    if (inlineRaw !== undefined) {
      raw = inlineRaw
    }
    else {
      i++
      const next = i < argv.length ? argv[i] : undefined
      if (next === undefined || next.startsWith('-'))
        throw new Error(`flag ${label} expects a value`)
      raw = next
    }

    validateFlagOptions(name, raw, def)
    accumulateFlagValue(flags, name, coerceFlagValue(raw, def), def)
  }

  const args: ParsedArgs = {}
  for (let j = 0; j < argDefs.length; j++) {
    const entry = argDefs[j]
    if (!entry)
      continue

    const [argName, argDef] = entry
    if (j < positional.length) {
      args[argName] = positional[j]
    }
    else if (argDef.required) {
      throw new Error(`missing required argument: ${argName}`)
    }
  }

  for (const [name, def] of Object.entries(meta.flags)) {
    if (!(name in flags) && def.default !== undefined)
      flags[name] = def.default
  }

  return { args, flags }
}
