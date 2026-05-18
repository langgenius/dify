import type { ArgDefinition, CommandMeta, FlagDefinition, ParsedArgs, ParsedFlags } from './types.js'

function stringFlag<const Opts extends { description: string, char?: string, default?: string, multiple?: boolean, helpGroup?: string }>(
  opts: Opts,
): FlagDefinition<Opts extends { default: string } ? string : string | undefined> {
  return { type: 'string', ...opts } as FlagDefinition<Opts extends { default: string } ? string : string | undefined>
}

function booleanFlag(opts: { description: string, char?: string, default?: boolean, helpGroup?: string }): FlagDefinition<boolean> {
  return { type: 'boolean', ...opts }
}

function integerFlag<const Opts extends { description: string, char?: string, default?: number, helpGroup?: string }>(
  opts: Opts,
): FlagDefinition<Opts extends { default: number } ? number : number | undefined> {
  return { type: 'integer', ...opts } as FlagDefinition<Opts extends { default: number } ? number : number | undefined>
}

export const Flags = {
  string: stringFlag,
  boolean: booleanFlag,
  integer: integerFlag,
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

function resolveByChar(char: string, meta: CommandMeta): [name: string, def: FlagDefinition] | undefined {
  for (const [name, def] of Object.entries(meta.flags)) {
    if (def.char === char)
      return [name, def]
  }

  return undefined
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

    if (!pastDoubleDash && token.startsWith('--')) {
      const eqIdx = token.indexOf('=')
      let name: string
      let rawValue: string | undefined

      if (eqIdx !== -1) {
        name = token.slice(2, eqIdx)
        rawValue = token.slice(eqIdx + 1)
      }
      else {
        name = token.slice(2)
        rawValue = undefined
      }

      const def = meta.flags[name]
      if (!def)
        continue

      if (def.type === 'boolean') {
        flags[name] = rawValue === undefined ? true : coerceFlagValue(rawValue, def)
      }
      else if (rawValue !== undefined) {
        flags[name] = coerceFlagValue(rawValue, def)
      }
      else {
        i++
        const next = i < argv.length ? argv[i] : undefined
        if (next === undefined || next.startsWith('-'))
          throw new Error(`flag --${name} expects a value`)

        flags[name] = coerceFlagValue(next, def)
      }
    }
    else if (!pastDoubleDash && token.startsWith('-') && token.length === 2 && token[1] !== undefined) {
      const char = token[1]
      const resolved = resolveByChar(char, meta)
      if (!resolved)
        continue

      const [flagName, def] = resolved
      if (def.type === 'boolean') {
        flags[flagName] = true
      }
      else {
        i++
        const next = i < argv.length ? argv[i] : undefined
        if (next === undefined || next.startsWith('-'))
          throw new Error(`flag -${char} expects a value`)

        flags[flagName] = coerceFlagValue(next, def)
      }
    }
    else {
      positional.push(token)
    }
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
