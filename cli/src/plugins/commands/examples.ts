import type { CatalogOp, Example, JsonSchema } from '@/plugins/catalog'
import type { Hint } from '@/protocol/hint'
import { COMMAND_SEPARATOR, spacedId } from '@/protocol/op-id'
import { isRepeatable, isScalar, propertiesOf, shapeOf } from '@/protocol/shape'
import { argToken, flagToken } from '@/util/flag-name'
import { shellWord } from '@/util/shell-word'
import { BINARY } from '@/version/info'

export type CommandExample = Example & Readonly<{ command: string }>

type ExampleSource = Readonly<{ id: string; input: JsonSchema; positional: readonly string[] }>

const PLACEHOLDER = /^<[^<>]*>$/
const SKELETON_TITLE = 'Required fields'
const INPUT_FLAG = flagToken('input')

// Whether a value is one the caller fills in: it prints as itself, whatever the field's shape.
type IsPlaceholder = (name: string, value: unknown) => boolean

const looksLikePlaceholder: IsPlaceholder = (_name, value) =>
  typeof value === 'string' && PLACEHOLDER.test(value)

function word(text: string, placeholder: boolean): string {
  return placeholder ? text : shellWord(text)
}

function valueToken(
  property: JsonSchema | undefined,
  value: unknown,
  placeholder: boolean,
): string {
  const scalar =
    typeof value === 'string' || (property !== undefined && isScalar(shapeOf(property)))
  return word(scalar ? String(value) : JSON.stringify(value), placeholder)
}

// How the field is typed: a boolean as its presence, a repeatable list as the flag
// once per item, anything else as one value.
function flagTokens(
  name: string,
  property: JsonSchema | undefined,
  value: unknown,
  isPlaceholder: IsPlaceholder,
): string[] {
  const flag = flagToken(name)
  if (value === true) return [flag]
  if (value === false) return [`${flag}=false`]
  if (property !== undefined && isRepeatable(shapeOf(property)) && Array.isArray(value))
    return value.flatMap((item) => [flag, word(String(item), isPlaceholder(name, item))])
  return [flag, valueToken(property, value, isPlaceholder(name, value))]
}

// Positionals keep their declared order, so an example that skips one does not shift the
// rest along: the one it skipped prints as itself.
export function exampleLine(
  d: ExampleSource,
  example: Example,
  isPlaceholder: IsPlaceholder = looksLikePlaceholder,
): string {
  const properties = propertiesOf(d.input)
  const flags = Object.keys(example.input).filter((name) => !d.positional.includes(name))
  return [
    BINARY,
    d.id,
    ...d.positional.map((name) =>
      name in example.input
        ? valueToken(
            properties[name],
            example.input[name],
            isPlaceholder(name, example.input[name]),
          )
        : argToken(name),
    ),
    ...flags.flatMap((name) =>
      flagTokens(name, properties[name], example.input[name], isPlaceholder),
    ),
  ].join(COMMAND_SEPARATOR)
}

export function commandExamples(d: ExampleSource, examples: readonly Example[]): CommandExample[] {
  return examples.map((example) => ({ ...example, command: exampleLine(d, example) }))
}

// The text view of a command that ships no example still gets a runnable line: the
// required fields, each standing for itself.
export function skeletonExample(d: ExampleSource): CommandExample {
  const required = Array.isArray(d.input.required) ? d.input.required.map(String) : []
  const example = {
    title: SKELETON_TITLE,
    input: Object.fromEntries(required.map((name) => [name, argToken(name)])),
  }
  return { ...example, command: exampleLine(d, example) }
}

const SAFE_FLAG_NAME = /^[a-z0-9_][a-z0-9_-]*$/

// A hint is a command the server suggests. A field the server left null is one the
// caller fills in. A field name that cannot be typed as a flag (reserved, or not a safe
// word) sends the whole input as JSON, exactly as the server wrote it.
export function hintLine(
  hint: Hint,
  op: CatalogOp | undefined,
  reserved: readonly string[],
): string {
  const id = spacedId(hint.op)
  const input = hint.input ?? {}
  const names = Object.keys(input)
  if (names.some((name) => reserved.includes(name) || !SAFE_FLAG_NAME.test(name)))
    return [BINARY, id, INPUT_FLAG, shellWord(JSON.stringify(input))].join(COMMAND_SEPARATOR)
  const filled = Object.fromEntries(
    Object.entries(input).map(([name, value]) => [name, value === null ? argToken(name) : value]),
  )
  return exampleLine(
    { id, input: op?.input ?? {}, positional: [] },
    { title: hint.summary, input: filled },
    (name) => input[name] === null,
  )
}
