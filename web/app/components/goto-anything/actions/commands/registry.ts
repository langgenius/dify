import type { CommandSearchResult } from '../types'
import type { CommandContext, SlashCommand } from './types'

export class SlashCommandRegistry {
  private readonly commands: readonly SlashCommand[]
  private readonly byName = new Map<string, SlashCommand>()

  constructor(commands: readonly SlashCommand[]) {
    this.commands = [...commands]
    for (const command of commands) {
      for (const name of [command.name, ...(command.aliases ?? [])]) {
        if (this.byName.has(name)) throw new Error(`Duplicate slash command: ${name}`)
        this.byName.set(name, command)
      }
    }
  }

  findCommand(name: string) {
    return this.byName.get(name)
  }

  getAvailableCommands(context: CommandContext) {
    return this.commands.filter((command) => command.isAvailable?.(context) ?? true)
  }

  async execute(name: string, args: Record<string, unknown>, context: CommandContext) {
    const command = this.findCommand(name)
    if (!command || command.isAvailable?.(context) === false) return
    try {
      await command.execute(args, context)
    } catch (error) {
      context.onError(error)
    }
  }

  search(query: string, context: CommandContext): CommandSearchResult[] {
    const input = query.trim().replace(/^\//, '').trim()
    const commands = this.getAvailableCommands(context)
    if (!input) return commands.map((command) => this.toResult(command))

    const name = input.split(/\s/, 1)[0]!.toLowerCase()
    const args = input.slice(name.length).trim()
    const exact = this.findCommand(name)
    if (exact?.isAvailable?.(context) === false) return []
    const command =
      exact ??
      commands.find((candidate) => candidate.aliases?.some((alias) => alias.startsWith(name))) ??
      commands.find((candidate) => candidate.name.startsWith(name))
    if (command) {
      try {
        return command.search(args, context)
      } catch (error) {
        console.warn(`Command search failed for ${command.name}:`, error)
        return []
      }
    }

    return commands.flatMap((candidate) =>
      [candidate.name, ...(candidate.aliases ?? [])]
        .filter((name) => name.toLowerCase().includes(input.toLowerCase()))
        .map((name) => this.toResult(candidate, name)),
    )
  }

  private toResult(command: SlashCommand, name = command.name): CommandSearchResult {
    return {
      id: `root-${name}`,
      title: `/${name}`,
      description: command.description,
      type: 'command',
      data: { command: command.name },
    }
  }
}
