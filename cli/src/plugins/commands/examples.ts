import type { Example, JsonSchema } from '@/plugins/catalog'
import { COMMAND_SEPARATOR } from '@/protocol/op-id'
import { isRepeatable, isScalar, propertiesOf, shapeOf } from '@/protocol/shape'
import { argToken, flagToken } from '@/util/flag-name'
import { shellWord } from '@/util/shell-word'
import { BINARY } from '@/version/info'

export type CommandExample = Example & Readonly<{ command: string }>

type ExampleSource = Readonly<{ id: string; input: JsonSchema; positional: readonly string[] }>

const PLACEHOLDER = /^<[^<>]*>$/
const SKELETON_TITLE = 'Required fields'

// A placeholder stands for a value the caller fills in, whatever the field's shape.
function word(text: string): string {
  return PLACEHOLDER.test(text) ? text : shellWord(text)
}

function valueToken(property: JsonSchema | undefined, value: unknown): string {
  const scalar =
    typeof value === 'string' || (property !== undefined && isScalar(shapeOf(property)))
  return word(scalar ? String(value) : JSON.stringify(value))
}

// How the field is typed: a boolean as its presence, a repeatable list as the flag
// once per item, anything else as one value.
function flagTokens(name: string, property: JsonSchema | undefined, value: unknown): string[] {
  const flag = flagToken(name)
  if (value === true) return [flag]
  if (value === false) return [`${flag}=false`]
  if (property !== undefined && isRepeatable(shapeOf(property)) && Array.isArray(value))
    return value.flatMap((item) => [flag, word(String(item))])
  return [flag, valueToken(property, value)]
}

// Positionals keep their declared order, so an example that skips one does not shift the
// rest along: the one it skipped prints as itself.
export function exampleLine(d: ExampleSource, example: Example): string {
  const properties = propertiesOf(d.input)
  const flags = Object.keys(example.input).filter((name) => !d.positional.includes(name))
  return [
    BINARY,
    d.id,
    ...d.positional.map((name) =>
      name in example.input ? valueToken(properties[name], example.input[name]) : argToken(name),
    ),
    ...flags.flatMap((name) => flagTokens(name, properties[name], example.input[name])),
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
