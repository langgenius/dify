import type { CommandConstructor, CommandEffect } from './command'
import type { CommandTree } from './registry'
import type { ArgValueType, FlagDefinition } from './types'
import type { HelpTopic } from '@/help/topics'
import { dump } from 'js-yaml'
import { CONTRACT, GLOBAL_FLAG_HELP } from '@/help/contract'
import { TOPICS } from '@/help/topics'
import { collectCommands } from './registry'

const BIN = 'difyctl'

export type FlagDescriptor = {
  name: string
  char: string | null
  type: string
  default: ArgValueType | null
  multiple: boolean
  options: readonly string[] | null
  description: string
}

export type ArgDescriptor = {
  name: string
  required: boolean
  description: string
}

export type CommandDescriptor = {
  command: string
  description: string | null
  effect: CommandEffect
  args: ArgDescriptor[]
  flags: FlagDescriptor[]
  examples: string[]
  agentGuide: string | null
}

function isStructured(format: string): boolean {
  return format === 'json' || format === 'yaml'
}

function serialize(value: unknown, format: string): string {
  if (format === 'yaml') return dump(value, { indent: 2, lineWidth: -1 })
  return `${JSON.stringify(value, null, 2)}\n`
}

function flagLabel(name: string, def: FlagDefinition): string {
  const aliases: string[] = []

  if (def.char) aliases.push(`-${def.char}`)

  aliases.push(`--${name}`)

  const label = aliases.join(', ')

  return def.type === 'boolean' ? label : `${label} <${def.type}>`
}

function flagDefault(def: FlagDefinition): string {
  if (def.default === undefined) return ''

  return ` [default: ${JSON.stringify(def.default)}]`
}

function renderExamples(ctor: CommandConstructor): string[] {
  return (ctor.examples ?? []).map((ex) => ex.replace('<%= config.bin %>', BIN))
}

function agentGuideOf(ctor: CommandConstructor): string {
  const C = ctor
  return new C().agentGuide()
}

export function describeCommand(ctor: CommandConstructor, path: string): CommandDescriptor {
  const guide = agentGuideOf(ctor)

  return {
    command: path,
    description: ctor.description ?? null,
    effect: ctor.effect ?? 'read',
    args: Object.entries(ctor.args ?? {}).map(([name, def]) => ({
      name,
      required: def.required ?? false,
      description: def.description,
    })),
    flags: Object.entries(ctor.flags ?? {}).map(([name, def]) => ({
      name,
      char: def.char ?? null,
      type: def.type,
      default: def.default ?? null,
      multiple: def.multiple ?? false,
      options: def.options ?? null,
      description: def.description,
    })),
    examples: renderExamples(ctor),
    agentGuide: guide.length > 0 ? guide : null,
  }
}

function formatHelpText(ctor: CommandConstructor, path: string): string {
  const lines: string[] = []

  if (ctor.description) lines.push(ctor.description, '')

  lines.push(
    'USAGE',
    `  $ ${BIN} ${path}${ctor.args && Object.keys(ctor.args).length > 0 ? ' [ARGS]' : ''}${ctor.flags && Object.keys(ctor.flags).length > 0 ? ' [FLAGS]' : ''}`,
    '',
  )

  if (ctor.args && Object.keys(ctor.args).length > 0) {
    lines.push('ARGUMENTS')

    for (const [name, def] of Object.entries(ctor.args)) {
      const required = def.required ? ' (required)' : ''
      lines.push(`  ${name}${required}  ${def.description}`)
    }

    lines.push('')
  }

  if (ctor.flags && Object.keys(ctor.flags).length > 0) {
    lines.push('FLAGS')

    for (const [name, def] of Object.entries(ctor.flags)) {
      lines.push(`  ${flagLabel(name, def)}  ${def.description}${flagDefault(def)}`)
    }

    lines.push('')
  }

  if (ctor.examples && ctor.examples.length > 0) {
    lines.push('EXAMPLES')

    for (const ex of renderExamples(ctor)) {
      lines.push(`  $ ${ex}`)
    }

    lines.push('')
  }

  const guide = agentGuideOf(ctor)

  if (guide.length > 0) lines.push(guide)

  return lines.join('\n')
}

export function formatHelp(ctor: CommandConstructor, path: string, format = ''): string {
  if (isStructured(format)) return serialize(describeCommand(ctor, path), format)

  return formatHelpText(ctor, path)
}

export function formatTopic(topic: HelpTopic, format = ''): string {
  if (isStructured(format))
    return serialize({ name: topic.name, summary: topic.summary, body: topic.render() }, format)

  return topic.render()
}

// Renders a list of commands as aligned `path  description` rows, grouped by
// their first path segment (a blank line between groups). Shared by the
// top-level overview and namespace drill-in (`difyctl <group> --help`) so both
// derive from the same full-depth `collectCommands` walk and the canonical
// space-joined command path.
export function renderCommandRows(
  commands: Array<{ command: CommandConstructor; path: string[] }>,
): string {
  const rows = commands.map(({ command, path }) => ({
    label: path.join(' '),
    desc: command.description ?? '',
    group: path[0] ?? '',
  }))

  const width = rows.reduce((max, r) => Math.max(max, r.label.length), 0) + 2
  const lines: string[] = []
  let prevGroup: string | undefined

  for (const r of rows) {
    if (prevGroup !== undefined && r.group !== prevGroup) lines.push('')

    prevGroup = r.group
    lines.push(r.desc ? `  ${r.label.padEnd(width)}${r.desc}` : `  ${r.label}`)
  }

  return lines.join('\n')
}

// Renders a command list (a namespace subtree for `<group> --help`) in the
// requested format: structured formats serialize per-command descriptors — the
// same shape as the top-level site map's `commands` — while text renders the
// aligned rows. Keeps `<group> --help -o json` machine-readable like every
// other help surface.
export function formatCommandList(
  commands: Array<{ command: CommandConstructor; path: string[] }>,
  format: string,
): string {
  if (isStructured(format))
    return serialize(
      { commands: commands.map(({ command, path }) => describeCommand(command, path.join(' '))) },
      format,
    )

  return `COMMANDS\n${renderCommandRows(commands)}\n`
}

// Curated onboarding examples for the top-level overview (gh-style): the
// shortest path from zero to a structured app run. Editorial, not an exhaustive
// dump — per-command examples live in each command's own `--help`.
const ROOT_EXAMPLES = [`${BIN} auth login`, `${BIN} get app`, `${BIN} run app <id> "hello" -o json`]

function renderTopicRows(): string {
  const width = TOPICS.reduce((max, t) => Math.max(max, t.name.length), 0) + 2
  return TOPICS.map((t) => `  ${t.name.padEnd(width)}${t.summary}`).join('\n')
}

function renderGlobalFlagRows(): string {
  const width = GLOBAL_FLAG_HELP.reduce((max, f) => Math.max(max, f.label.length), 0) + 2
  return GLOBAL_FLAG_HELP.map((f) => `  ${f.label.padEnd(width)}${f.description}`).join('\n')
}

function formatTopLevelHelpText(tree: CommandTree): string {
  const sections = [
    `${BIN} — Dify command-line interface`,
    `USAGE\n  ${BIN} <command> <subcommand> [flags]`,
    `COMMANDS\n${renderCommandRows(collectCommands(tree))}`,
    `EXAMPLES\n${ROOT_EXAMPLES.map((ex) => `  $ ${ex}`).join('\n')}`,
    `GLOBAL FLAGS\n${renderGlobalFlagRows()}`,
    `GUIDES\n${renderTopicRows()}`,
    `LEARN MORE\n` +
      `  Use \`${BIN} <command> --help\` for details on a command.\n` +
      `  New here? Run \`${BIN} help account\`.  Agents: \`${BIN} help agent\` or \`${BIN} --help -o json\`.`,
  ]

  return `${sections.join('\n\n')}\n`
}

export function formatTopLevelHelp(tree: CommandTree, format: string): string {
  if (isStructured(format)) {
    return serialize(
      {
        bin: BIN,
        contract: CONTRACT,
        commands: collectCommands(tree).map(({ command, path }) =>
          describeCommand(command, path.join(' ')),
        ),
        topics: TOPICS.map((t) => ({ name: t.name, summary: t.summary })),
      },
      format,
    )
  }

  return formatTopLevelHelpText(tree)
}
