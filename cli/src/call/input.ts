import type { JsonSchema } from '@/plugins/catalog'
import { inputInvalid } from '@/call/errors'
import { errorMessage } from '@/errors/message'
import { isScalar, propertiesOf, shapeOf } from '@/protocol/shape'
import { isRecord } from '@/util/is-record'

export type InputSource = {
  readonly raw: string | undefined
  readonly stdin: () => Promise<string>
  readonly readFile: (p: string) => Promise<string>
}

export type FileRefSource = Pick<InputSource, 'stdin' | 'readFile'>

/** Text read from an `@…` reference, with the name errors about it should use. */
type Referenced = Readonly<{ text: string; source: string }>

const FILE_PREFIX = '@'
const STDIN_MARKER = '-'
const STDIN_SOURCE = `${FILE_PREFIX}${STDIN_MARKER}`
const FLAG_PREFIX = '--'
const INLINE_SOURCE = '--input'
const STDIN_LABEL = 'stdin'

export function parseJsonValue(raw: string, source: string): unknown {
  try {
    return JSON.parse(raw)
  } catch (cause) {
    throw inputInvalid(`${source}: not valid JSON (${errorMessage(cause)})`, cause)
  }
}

function parseJsonObject(raw: string, source: string): Record<string, unknown> {
  const parsed = parseJsonValue(raw, source)
  if (!isRecord(parsed)) throw inputInvalid(`${INLINE_SOURCE} must be a JSON object`)
  return parsed
}

async function readRef(ref: string, src: FileRefSource): Promise<Referenced> {
  if (ref === STDIN_SOURCE) return { text: await src.stdin(), source: STDIN_LABEL }
  const path = ref.slice(FILE_PREFIX.length)
  try {
    return { text: await src.readFile(path), source: path }
  } catch (cause) {
    throw inputInvalid(`cannot read input file "${path}"`, cause)
  }
}

export async function loadInput(src: InputSource): Promise<Record<string, unknown>> {
  if (src.raw === undefined) return {}
  if (!src.raw.startsWith(FILE_PREFIX)) return parseJsonObject(src.raw, INLINE_SOURCE)
  const { text, source } = await readRef(src.raw, src)
  return parseJsonObject(text, source)
}

// A non-scalar field typed as a flag keeps its raw `@…` string through the parser,
// which cannot read files; it becomes the referenced JSON only here. Any JSON value will
// do — the field's own schema, not this function, says what shape it must have.
export async function resolveFileRefs(
  fields: Record<string, unknown>,
  schema: JsonSchema,
  src: FileRefSource,
): Promise<Record<string, unknown>> {
  const properties = propertiesOf(schema)
  const resolved = { ...fields }
  for (const [name, value] of Object.entries(fields)) {
    const property = properties[name]
    if (property === undefined) continue
    if (typeof value !== 'string' || !value.startsWith(FILE_PREFIX)) continue
    if (isScalar(shapeOf(property))) continue
    const { text } = await readRef(value, src)
    resolved[name] = parseJsonValue(text, `${FLAG_PREFIX}${name}`)
  }
  return resolved
}

export function applyPins(
  input: Record<string, unknown>,
  schema: JsonSchema,
  pins: Readonly<Record<string, string | null>>,
): Record<string, unknown> {
  const properties = propertiesOf(schema)
  const result = { ...input }
  for (const [key, pin] of Object.entries(pins)) {
    if (pin === null) continue
    if (!(key in properties)) continue
    if (key in result) continue
    result[key] = pin
  }
  return result
}
