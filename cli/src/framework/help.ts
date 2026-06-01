import type { CommandConstructor, CommandEffect } from './command'
import type { CommandTree } from './registry'
import type { ArgValueType, FlagDefinition } from './types'
import type { HelpTopic } from '@/help/topics'
import yaml from 'js-yaml'
import { CONTRACT } from '@/help/contract'
import { TOPICS } from '@/help/topics'
import { collectCommands } from './registry'

const BIN = 'difyctl'

export type FlagDescriptor = {
  name: string
  char: string | null
  type: string
  default: ArgValueType | null
  multiple: boolean
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
  if (format === 'yaml')
    return yaml.dump(value, { indent: 2, lineWidth: -1 })
  return `${JSON.stringify(value, null, 2)}\n`
}

function flagLabel(name: string, def: FlagDefinition): string {
  const aliases: string[] = []

  if (def.char)
    aliases.push(`-${def.char}`)

  aliases.push(`--${name}`)

  const label = aliases.join(', ')

  return def.type === 'boolean' ? label : `${label} <${def.type}>`
}

function flagDefault(def: FlagDefinition): string {
  if (def.default === undefined)
    return ''

  return ` [default: ${JSON.stringify(def.default)}]`
}

function renderExamples(ctor: CommandConstructor): string[] {
  return (ctor.examples ?? []).map(ex => ex.replace('<%= config.bin %>', BIN))
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
      description: def.description,
    })),
    examples: renderExamples(ctor),
    agentGuide: guide.length > 0 ? guide : null,
  }
}

function formatHelpText(ctor: CommandConstructor, path: string): string {
  const lines: string[] = []

  if (ctor.description)
    lines.push(ctor.description, '')

  lines.push('USAGE', `  $ ${BIN} ${path}${ctor.args && Object.keys(ctor.args).length > 0 ? ' [ARGS]' : ''}${ctor.flags && Object.keys(ctor.flags).length > 0 ? ' [FLAGS]' : ''}`, '')

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

  if (guide.length > 0)
    lines.push(guide)

  return lines.join('\n')
}

export function formatHelp(ctor: CommandConstructor, path: string, format = ''): string {
  if (isStructured(format))
    return serialize(describeCommand(ctor, path), format)

  return formatHelpText(ctor, path)
}

export function formatTopic(topic: HelpTopic, format = ''): string {
  if (isStructured(format))
    return serialize({ name: topic.name, summary: topic.summary, body: topic.render() }, format)

  return topic.render()
}

export function formatTopLevelHelp(tree: CommandTree, format: string): string {
  return serialize({
    bin: BIN,
    contract: CONTRACT,
    commands: collectCommands(tree).map(({ command, path }) => describeCommand(command, path.join(' '))),
    topics: TOPICS.map(t => ({ name: t.name, summary: t.summary })),
  }, format)
}
