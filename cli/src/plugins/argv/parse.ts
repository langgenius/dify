import type { JsonSchema } from '@/plugins/catalog'
import { z } from 'zod'
import { BaseError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { isRecord } from '@/util/is-record'

export type ArgvSpec = {
  readonly positional: readonly string[]
  readonly schema: JsonSchema
}

export type ArgvPartition = {
  readonly matched: string[]
  readonly rest: string[]
}

const LONG_PREFIX = '--'
const SHORT_PREFIX = '-'
const END_OF_FLAGS = '--'
const VALUE_SEPARATOR = '='
const FLAG_WORD_SEPARATOR = '-'
const PROPERTY_WORD_SEPARATOR = '_'

const JsonType = {
  String: 'string',
  Integer: 'integer',
  Number: 'number',
  Boolean: 'boolean',
  Array: 'array',
} as const

const BOOLEAN_LITERALS: Readonly<Record<string, boolean>> = { true: true, false: false }

type Coercion = (raw: string) => unknown

const KEEP_RAW: Coercion = (raw) => raw

// `Number('')` and `Number(' ')` are 0, which would turn an empty flag value into a
// number the caller never typed; blank stays raw so validation reports it.
const toNumber: Coercion = (raw) => {
  if (raw.trim() === '') return raw
  const value = Number(raw)
  return Number.isFinite(value) ? value : raw
}

// A value that does not fit its declared type is left as typed so validation, not
// the parser, gets to report it.
const COERCIONS: Readonly<Record<string, Coercion>> = {
  [JsonType.Integer]: toNumber,
  [JsonType.Number]: toNumber,
  [JsonType.Boolean]: (raw) => BOOLEAN_LITERALS[raw] ?? raw,
  [JsonType.String]: KEEP_RAW,
}

function invalidFlag(message: string): BaseError {
  return new BaseError({ code: ErrorCode.UsageInvalidFlag, message })
}

function propertiesOf(schema: JsonSchema): Record<string, JsonSchema> {
  return isRecord(schema.properties) ? (schema.properties as Record<string, JsonSchema>) : {}
}

function typeOf(property: JsonSchema | undefined): string | undefined {
  return typeof property?.type === 'string' ? property.type : undefined
}

function itemTypeOf(property: JsonSchema): string | undefined {
  return isRecord(property.items) && typeof property.items.type === 'string'
    ? property.items.type
    : undefined
}

function coerce(type: string | undefined, raw: string): unknown {
  return (type === undefined ? KEEP_RAW : (COERCIONS[type] ?? KEEP_RAW))(raw)
}

function assign(
  target: Record<string, unknown>,
  key: string,
  property: JsonSchema | undefined,
  raw: string,
): void {
  if (property !== undefined && typeOf(property) === JsonType.Array) {
    const existing = target[key]
    const values = Array.isArray(existing) ? existing : []
    values.push(coerce(itemTypeOf(property), raw))
    target[key] = values
    return
  }
  target[key] = coerce(typeOf(property), raw)
}

function splitFlag(token: string): { name: string; value: string | undefined } {
  const body = token.slice(LONG_PREFIX.length)
  const at = body.indexOf(VALUE_SEPARATOR)
  if (at === -1) return { name: body, value: undefined }
  return { name: body.slice(0, at), value: body.slice(at + 1) }
}

function propertyFor(name: string): string {
  return name.split(FLAG_WORD_SEPARATOR).join(PROPERTY_WORD_SEPARATOR)
}

// Both help and validation describe what a caller may pass, so a defaulted property
// must stay optional — that is the schema's 'input' view, not its output view.
export function inputSchema(input: z.ZodObject): JsonSchema {
  return z.toJSONSchema(input, { io: 'input' }) as JsonSchema
}

export function partitionArgv(argv: readonly string[], schema: JsonSchema): ArgvPartition {
  const properties = propertiesOf(schema)
  const matched: string[] = []
  const rest: string[] = []

  for (let index = 0; index < argv.length; index++) {
    const token = argv[index] as string
    if (token === END_OF_FLAGS) {
      rest.push(...argv.slice(index))
      break
    }
    const property = token.startsWith(LONG_PREFIX)
      ? properties[propertyFor(splitFlag(token).name)]
      : undefined
    if (property === undefined) {
      rest.push(token)
      continue
    }
    matched.push(token)
    const needsValue = typeOf(property) !== JsonType.Boolean && splitFlag(token).value === undefined
    if (needsValue && index + 1 < argv.length) matched.push(argv[++index] as string)
  }

  return { matched, rest }
}

export function parseArgv(argv: readonly string[], spec: ArgvSpec): Record<string, unknown> {
  const properties = propertiesOf(spec.schema)
  const parsed: Record<string, unknown> = {}
  let positionals = 0
  let flagsEnded = false

  for (let index = 0; index < argv.length; index++) {
    const token = argv[index] as string

    if (!flagsEnded && token === END_OF_FLAGS) {
      flagsEnded = true
      continue
    }

    if (!flagsEnded && token.startsWith(SHORT_PREFIX) && token.length > SHORT_PREFIX.length) {
      if (!token.startsWith(LONG_PREFIX)) throw invalidFlag(`unknown flag "${token}"`)
      const { name, value } = splitFlag(token)
      const key = propertyFor(name)
      const property = properties[key]
      if (property === undefined) throw invalidFlag(`unknown flag "${token}"`)

      if (typeOf(property) === JsonType.Boolean) {
        parsed[key] = value === undefined ? true : coerce(JsonType.Boolean, value)
        continue
      }

      let raw = value
      if (raw === undefined) {
        index += 1
        raw = argv[index]
        if (raw === undefined) throw invalidFlag(`flag "${token}" needs a value`)
      }
      assign(parsed, key, property, raw)
      continue
    }

    const name = spec.positional[positionals]
    if (name === undefined) throw invalidFlag(`unexpected argument "${token}"`)
    positionals += 1
    assign(parsed, name, properties[name], token)
  }

  return parsed
}
