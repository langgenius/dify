import type { CommandEffect } from './command'
import type { Descriptor } from './describe'
import type { HelpEntry, HelpHead, HelpListing, HelpMap } from './help'
import type { Example, JsonSchema } from '@/plugins/catalog'
import type { Style } from '@/sys/io/color'
import type { View } from '@/sys/io/view'
import { inputSchema } from '@/plugins/argv/parse'
import { GLOBAL_INPUT } from '@/plugins/global-flags'
import { COMMAND_SEPARATOR } from '@/protocol/op-id'
import { isRepeatable, isScalar, labelOf, propertiesOf, shapeOf } from '@/protocol/shape'
import { view } from '@/sys/io/view'
import { flagFor } from '@/util/flag-name'
import { BINARY } from '@/version/info'

export type FieldRow = Readonly<{
  name: string
  label: string
  presence: string
  description: string
  positional: boolean
}>

type Section = Readonly<{ title: string; lines: (d: Descriptor, style: Style) => string[] }>
type Tagged = Readonly<{ effect?: CommandEffect; kind?: string; deprecated?: boolean }>

const PRESENCE = { Required: 'required', Optional: 'optional' } as const
const FIRST_LINE = /\r?\n/
const PLACEHOLDER = /^<[^<>]*>$/
const GAP = '  '
const INDENT = '  '
const NEWLINE = '\n'
const BLOCK_BREAK = '\n\n'
const LIST_SEPARATOR = ', '
const COMMAND_NOUN = { one: 'command', many: 'commands' } as const
const DEPRECATED = 'deprecated'
const NO_PIN = '(none)'
const SKELETON_TITLE = 'Required fields'
const COMMENT = '#'
const NO_POSITIONAL: readonly string[] = []

/** Pads every column but leaves the last one free, so a styled cell keeps its width. */
function aligned(rows: readonly (readonly string[])[]): string[] {
  const widths: number[] = []
  for (const cells of rows)
    cells.forEach((cell, at) => {
      widths[at] = Math.max(widths[at] ?? 0, cell.length)
    })
  return rows.map((cells) =>
    cells
      .map((cell, at) => cell.padEnd(widths[at] ?? 0))
      .join(GAP)
      .trimEnd(),
  )
}

function firstLine(text: unknown): string {
  return typeof text === 'string' ? (text.split(FIRST_LINE)[0] ?? '') : ''
}

function presenceOf(name: string, schema: JsonSchema, property: JsonSchema): string {
  if (Array.isArray(schema.required) && schema.required.includes(name)) return PRESENCE.Required
  return property.default !== undefined && property.default !== null
    ? JSON.stringify(property.default)
    : PRESENCE.Optional
}

export function fieldRows(schema: JsonSchema, positional: readonly string[]): FieldRow[] {
  const rows = Object.entries(propertiesOf(schema)).map((entry) => ({
    name: entry[0],
    label: labelOf(shapeOf(entry[1])),
    presence: presenceOf(entry[0], schema, entry[1]),
    description: firstLine(entry[1].description),
    positional: positional.includes(entry[0]),
  }))
  return [...rows.filter((row) => row.positional), ...rows.filter((row) => !row.positional)]
}

function rowsToLines(rows: readonly FieldRow[]): string[] {
  return aligned(
    rows.map((row) => [
      row.positional ? `<${row.name}>` : `--${flagFor(row.name)}`,
      row.label,
      row.presence,
      row.description,
    ]),
  )
}

// A placeholder stands for a value the caller fills in, whatever the field's shape.
function valueToken(property: JsonSchema | undefined, value: unknown): string {
  const placeholder = typeof value === 'string' && PLACEHOLDER.test(value)
  const scalar = property !== undefined && isScalar(shapeOf(property))
  return placeholder || scalar ? String(value) : `'${JSON.stringify(value)}'`
}

// How the field is typed: a boolean as its presence, a repeatable list as the flag
// once per item, anything else as one value.
function flagTokens(name: string, property: JsonSchema | undefined, value: unknown): string[] {
  const flag = `--${flagFor(name)}`
  if (value === true) return [flag]
  if (value === false) return [`${flag}=false`]
  if (property !== undefined && isRepeatable(shapeOf(property)) && Array.isArray(value))
    return value.flatMap((item) => [flag, String(item)])
  return [flag, valueToken(property, value)]
}

// Positionals keep their declared order, so an example that skips one does not shift the
// rest along: the one it skipped prints as itself.
export function exampleLine(d: Descriptor, example: Example): string {
  const properties = propertiesOf(d.input)
  const flags = Object.keys(example.input).filter((name) => !d.positional.includes(name))
  return [
    BINARY,
    d.id,
    ...d.positional.map((name) =>
      name in example.input ? valueToken(properties[name], example.input[name]) : `<${name}>`,
    ),
    ...flags.flatMap((name) => flagTokens(name, properties[name], example.input[name])),
  ].join(COMMAND_SEPARATOR)
}

// A server that ships no example still gets a runnable line: the required fields,
// each standing for itself.
function examplesOf(d: Descriptor): readonly Example[] {
  if (d.examples.length > 0) return d.examples
  const required = Array.isArray(d.input.required) ? d.input.required.map(String) : []
  return [{ title: SKELETON_TITLE, input: Object.fromEntries(required.map((n) => [n, `<${n}>`])) }]
}

export const SECTIONS: readonly Section[] = [
  { title: 'Usage', lines: (d) => [d.usage] },
  {
    title: 'Arguments',
    lines: (d) => rowsToLines(fieldRows(d.input, d.positional).filter((row) => row.positional)),
  },
  {
    title: 'Flags',
    lines: (d) => rowsToLines(fieldRows(d.input, d.positional).filter((row) => !row.positional)),
  },
  {
    title: 'Options',
    lines: (d) => (d.options === undefined ? [] : rowsToLines(fieldRows(d.options, NO_POSITIONAL))),
  },
  {
    title: 'Global',
    lines: () => rowsToLines(fieldRows(inputSchema(GLOBAL_INPUT), NO_POSITIONAL)),
  },
  {
    title: 'Examples',
    lines: (d, style) =>
      examplesOf(d).flatMap((example) => [
        style.dim(`${COMMENT} ${example.title}`),
        exampleLine(d, example),
      ]),
  },
  {
    title: 'Pins',
    lines: (d) => aligned(Object.entries(d.pins ?? {}).map(([pin, at]) => [pin, at ?? NO_PIN])),
  },
]

function tagsOf(tagged: Tagged): string[] {
  const tags = [tagged.effect, tagged.kind, tagged.deprecated === true ? DEPRECATED : undefined]
  return tags.filter((tag): tag is string => tag !== undefined)
}

// Empty is no cell at all: a styled empty string is escape codes, not nothing.
function tagCell(tagged: Tagged, style: Style): string[] {
  const tags = tagsOf(tagged)
  return tags.length === 0 ? [] : [style.dim(tags.join(COMMAND_SEPARATOR))]
}

function descriptorText(d: Descriptor, style: Style): string {
  const header = [style.bold(d.id), d.summary, ...tagCell(d, style)]
  const blocks = [header.join(GAP)]
  for (const section of SECTIONS) {
    const lines = section.lines(d, style)
    if (lines.length === 0) continue
    blocks.push([style.bold(section.title), ...lines.map((line) => INDENT + line)].join(NEWLINE))
  }
  return blocks.join(BLOCK_BREAK)
}

export function descriptorView(d: Descriptor): View<Descriptor> {
  return view(d, (style) => descriptorText(d, style))
}

/** `help --full`: every descriptor, one after another. */
export function descriptorsView(rows: readonly Descriptor[]): View<{ commands: Descriptor[] }> {
  return view({ commands: [...rows] }, (style) =>
    rows.map((row) => descriptorText(row, style)).join(BLOCK_BREAK),
  )
}

function headText(head: HelpHead | undefined, style: Style): string {
  if (head === undefined) return ''
  if (head.summary !== undefined) return head.summary
  const noun = head.count === 1 ? COMMAND_NOUN.one : COMMAND_NOUN.many
  const groups = head.groups.length === 0 ? '' : `: ${head.groups.join(LIST_SEPARATOR)}`
  return style.dim(`${head.count} ${noun}${groups}`)
}

export function mapView(map: HelpMap): View<HelpMap> {
  return view(map, (style) =>
    aligned(
      Object.keys(map)
        .sort()
        .map((head) => [head, headText(map[head], style)]),
    ).join(NEWLINE),
  )
}

function listingRow(entry: HelpEntry, style: Style): string[] {
  return [entry.id, entry.summary, ...tagCell(entry, style)]
}

export function listingView(listing: HelpListing): View<HelpListing> {
  return view(listing, (style) =>
    aligned(listing.entries.map((entry) => listingRow(entry, style))).join(NEWLINE),
  )
}
