import type { JsonSchema } from '@/plugins/catalog'
import { inputInvalid } from '@/call/errors'
import { errorMessage } from '@/errors/message'
import { isRecord } from '@/util/is-record'

export type InputSource = {
  readonly raw: string | undefined
  readonly stdin: () => Promise<string>
  readonly readFile: (p: string) => Promise<string>
}

const FILE_PREFIX = '@'
const STDIN_MARKER = '-'
const STDIN_SOURCE = `${FILE_PREFIX}${STDIN_MARKER}`
const INLINE_SOURCE = '--input'
const STDIN_LABEL = 'stdin'

function parseJsonObject(raw: string, source: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (cause) {
    throw inputInvalid(`${source}: not valid JSON (${errorMessage(cause)})`, cause)
  }
  if (!isRecord(parsed)) throw inputInvalid('--input must be a JSON object')
  return parsed
}

export async function loadInput(src: InputSource): Promise<Record<string, unknown>> {
  if (src.raw === undefined) return {}
  if (src.raw === STDIN_SOURCE) return parseJsonObject(await src.stdin(), STDIN_LABEL)
  if (src.raw.startsWith(FILE_PREFIX)) {
    const path = src.raw.slice(FILE_PREFIX.length)
    let raw: string
    try {
      raw = await src.readFile(path)
    } catch (cause) {
      throw inputInvalid(`cannot read input file "${path}"`, cause)
    }
    return parseJsonObject(raw, path)
  }
  return parseJsonObject(src.raw, INLINE_SOURCE)
}

export function applyPins(
  input: Record<string, unknown>,
  schema: JsonSchema,
  pins: Readonly<Record<string, string | null>>,
): Record<string, unknown> {
  const properties = schema.properties
  if (!isRecord(properties)) return input
  const result = { ...input }
  for (const [key, pin] of Object.entries(pins)) {
    if (pin === null) continue
    if (!(key in properties)) continue
    if (key in result) continue
    result[key] = pin
  }
  return result
}
