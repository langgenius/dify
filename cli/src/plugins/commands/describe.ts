import type { CommandConstructor, CommandEffect } from './command'
import type { CommandTree } from './registry'
import type { Example, JsonSchema } from '@/plugins/catalog'
import { inputSchema } from '@/plugins/argv/parse'
import { BINARY } from '@/version/info'
import { collectCommands } from './registry'

export type CommandRow = {
  id: string
  usage: string
  summary: string
  effect: CommandEffect
  input: JsonSchema
  positional: readonly string[]
  examples: readonly Example[]
}

const OPTIONS = '[options]'

export function commandRow(ctor: CommandConstructor, path: readonly string[]): CommandRow {
  const id = path.join(' ')
  const args = ctor.positional.map((name) => `<${name}>`)
  return {
    id,
    usage: [BINARY, id, ...args, OPTIONS].join(' '),
    summary: ctor.summary,
    effect: ctor.effect,
    input: inputSchema(ctor.input),
    positional: ctor.positional,
    examples: ctor.examples,
  }
}

export function treeRows(tree: CommandTree): CommandRow[] {
  return collectCommands(tree).map(({ command, path }) => commandRow(command, path))
}
