import type { CommandSearchResult } from '../types'
import type { SlashCommand, SlashCommandHandler } from './types'

/**
 * Slash Command Registry System
 * Responsible for managing registration, lookup, and search of all slash commands
 */
export class SlashCommandRegistry {
  private commands = new Map<string, SlashCommand>()
  private commandDeps = new Map<string, unknown>()

  /**
   * Register command handler
   */
  register<TDeps>(handler: SlashCommandHandler<TDeps>, deps?: TDeps) {
    // Register main command name
    this.commands.set(handler.name, handler)

    // Register aliases
    if (handler.aliases) {
      handler.aliases.forEach((alias) => {
        this.commands.set(alias, handler)
      })
    }

    // Store dependencies and call registration method
    if (deps) {
      this.commandDeps.set(handler.name, deps)
      handler.register?.(deps)
    }
  }

  /**
   * Unregister command
   */
  unregister(name: string) {
    const handler = this.commands.get(name)
    if (handler) {
      // Call the command's unregister method
      handler.unregister?.()

      // Remove dependencies
      this.commandDeps.delete(handler.name)

      // Remove main command name
      this.commands.delete(handler.name)

      // Remove all aliases
      if (handler.aliases) {
        handler.aliases.forEach((alias) => {
          this.commands.delete(alias)
        })
      }
    }
  }

  /**
   * Find command handler
   */
  findCommand(commandName: string): SlashCommand | undefined {
    return this.commands.get(commandName)
  }

  /**
   * Smart partial command matching
   * Prioritize alias matching, then match command name prefix
   */
  private findBestPartialMatch(partialName: string): SlashCommand | undefined {
    const lowerPartial = partialName.toLowerCase()

    // First check if any alias starts with this
    const aliasMatch = this.findHandlerByAliasPrefix(lowerPartial)
    if (aliasMatch && this.isCommandAvailable(aliasMatch)) return aliasMatch

    // Then check if command name starts with this
    const nameMatch = this.findHandlerByNamePrefix(lowerPartial)
    return nameMatch && this.isCommandAvailable(nameMatch) ? nameMatch : undefined
  }

  /**
   * Find handler by alias prefix
   */
  private findHandlerByAliasPrefix(prefix: string): SlashCommand | undefined {
    for (const handler of this.getAllCommands()) {
      if (handler.aliases?.some((alias) => alias.toLowerCase().startsWith(prefix))) return handler
    }
    return undefined
  }

  /**
   * Find handler by name prefix
   */
  private findHandlerByNamePrefix(prefix: string): SlashCommand | undefined {
    return this.getAllCommands().find((handler) => handler.name.toLowerCase().startsWith(prefix))
  }

  /**
   * Get all registered commands (deduplicated)
   */
  getAllCommands(): SlashCommand[] {
    const uniqueCommands = new Map<string, SlashCommand>()
    this.commands.forEach((handler) => {
      uniqueCommands.set(handler.name, handler)
    })
    return Array.from(uniqueCommands.values())
  }

  /**
   * Get all available commands in current context (deduplicated and filtered)
   * Commands without isAvailable method are considered always available
   */
  getAvailableCommands(): SlashCommand[] {
    return this.getAllCommands().filter((handler) => this.isCommandAvailable(handler))
  }

  /**
   * Search commands
   * @param query Full query (e.g., "/theme dark" or "/lang en")
   * @param locale Current language
   */
  search(query: string, locale: string = 'en'): CommandSearchResult[] {
    const trimmed = query.trim()

    // Handle root level search "/"
    if (trimmed === '/' || !trimmed.replace('/', '').trim()) return this.getRootCommands()

    // Parse command and arguments
    const afterSlash = trimmed.substring(1).trim()
    const spaceIndex = afterSlash.indexOf(' ')
    const commandName = spaceIndex === -1 ? afterSlash : afterSlash.substring(0, spaceIndex)
    const args = spaceIndex === -1 ? '' : afterSlash.substring(spaceIndex + 1).trim()

    // First try exact match
    let handler = this.findCommand(commandName)
    if (handler && this.isCommandAvailable(handler)) {
      try {
        return handler.search(args, locale)
      } catch (error) {
        console.warn(`Command search failed for ${commandName}:`, error)
        return []
      }
    }

    // If no exact match, try smart partial matching
    handler = this.findBestPartialMatch(commandName)
    if (handler && this.isCommandAvailable(handler)) {
      try {
        return handler.search(args, locale)
      } catch (error) {
        console.warn(`Command search failed for ${handler.name}:`, error)
        return []
      }
    }

    // Finally perform fuzzy search
    return this.fuzzySearchCommands(afterSlash)
  }

  /**
   * Get root level command list
   * Only shows commands that are available in current context
   */
  private getRootCommands(): CommandSearchResult[] {
    return this.getAvailableCommands().map((handler) => ({
      id: `root-${handler.name}`,
      title: `/${handler.name}`,
      description: handler.description,
      type: 'command' as const,
      data: {
        command: `root.${handler.name}`,
        args: { name: handler.name },
      },
    }))
  }

  /**
   * Fuzzy search commands
   * Only shows commands that are available in current context
   */
  private fuzzySearchCommands(query: string): CommandSearchResult[] {
    const lowercaseQuery = query.toLowerCase()
    const matches: CommandSearchResult[] = []

    for (const handler of this.getAvailableCommands()) {
      // Check if command name matches
      if (handler.name.toLowerCase().includes(lowercaseQuery)) {
        matches.push({
          id: `fuzzy-${handler.name}`,
          title: `/${handler.name}`,
          description: handler.description,
          type: 'command' as const,
          data: {
            command: `root.${handler.name}`,
            args: { name: handler.name },
          },
        })
      }

      // Check if aliases match
      if (handler.aliases) {
        handler.aliases.forEach((alias) => {
          if (alias.toLowerCase().includes(lowercaseQuery)) {
            matches.push({
              id: `fuzzy-${alias}`,
              title: `/${alias}`,
              description: `${handler.description} (alias for /${handler.name})`,
              type: 'command' as const,
              data: {
                command: `root.${handler.name}`,
                args: { name: handler.name },
              },
            })
          }
        })
      }
    }

    return matches
  }

  /**
   * Get command dependencies
   */
  getCommandDependencies(commandName: string): unknown {
    return this.commandDeps.get(commandName)
  }

  /**
   * Determine if a command is available in the current context.
   * Defaults to true when a handler does not implement the guard.
   */
  private isCommandAvailable(handler: SlashCommand) {
    return handler.isAvailable?.() ?? true
  }
}

// Global registry instance
export const slashCommandRegistry = new SlashCommandRegistry()
