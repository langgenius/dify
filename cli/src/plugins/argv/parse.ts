import type { JsonSchema } from '@/plugins/catalog'
import type { ShapeNode } from '@/protocol/shape'
import { z } from 'zod'
import { BaseError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { coerceFor, isRepeatable, propertiesOf, SHAPE, shapeOf, takesValue } from '@/protocol/shape'
import { propertyFor } from '@/util/flag-name'

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

// A positional whose name has no matching schema property keeps the raw string —
// there is no declared type to coerce it against.
const UNKNOWN_PROPERTY_SHAPE: ShapeNode = { shape: SHAPE.String }

function invalidFlag(message: string): BaseError {
  return new BaseError({ code: ErrorCode.UsageInvalidFlag, message })
}

function assign(
  target: Record<string, unknown>,
  key: string,
  property: JsonSchema | undefined,
  raw: string,
): void {
  const node = property === undefined ? UNKNOWN_PROPERTY_SHAPE : shapeOf(property)
  const value = coerceFor(node)(raw)
  if (isRepeatable(node)) {
    const existing = target[key]
    target[key] = [...(Array.isArray(existing) ? existing : []), value]
    return
  }
  target[key] = value
}

function splitFlag(token: string): { name: string; value: string | undefined } {
  const body = token.slice(LONG_PREFIX.length)
  const at = body.indexOf(VALUE_SEPARATOR)
  if (at === -1) return { name: body, value: undefined }
  return { name: body.slice(0, at), value: body.slice(at + 1) }
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
    const needsValue = takesValue(shapeOf(property)) && splitFlag(token).value === undefined
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

      const node = shapeOf(property)
      if (!takesValue(node)) {
        parsed[key] = value === undefined ? true : coerceFor(node)(value)
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
