import type { SlashCommandHandler } from './types'
import type { CommandSearchResult } from '../types'

/**
 * Slash Command Registry System
 * Responsible for managing registration, lookup, and search of all slash commands
 */
export class SlashCommandRegistry {
  private commands = new Map<string, SlashCommandHandler>()
  private commandDeps = new Map<string, any>()

  /**
   * Register command handler
   */
  register<TDeps = any>(handler: SlashCommandHandler<TDeps>, deps?: TDeps) {
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
  findCommand(commandName: string): SlashCommandHandler | undefined {
    return this.commands.get(commandName)
  }

  /**
   * Smart partial command matching
   * Prioritize alias matching, then match command name prefix
   */
  private findBestPartialMatch(partialName: string): SlashCommandHandler | undefined {
    const lowerPartial = partialName.toLowerCase()

    // First check if any alias starts with this
    const aliasMatch = this.findHandlerByAliasPrefix(lowerPartial)
    if (aliasMatch)
      return aliasMatch

    // Then check if command name starts with this
    return this.findHandlerByNamePrefix(lowerPartial)
  }

  /**
   * Find handler by alias prefix
   */
  private findHandlerByAliasPrefix(prefix: string): SlashCommandHandler | undefined {
    for (const handler of this.getAllCommands()) {
      if (handler.aliases?.some(alias => alias.toLowerCase().startsWith(prefix)))
        return handler
    }
    return undefined
  }

  /**
   * Find handler by name prefix
   */
  private findHandlerByNamePrefix(prefix: string): SlashCommandHandler | undefined {
    return this.getAllCommands().find(handler =>
      handler.name.toLowerCase().startsWith(prefix),
    )
  }

  /**
   * Get all registered commands (deduplicated)
   */
  getAllCommands(): SlashCommandHandler[] {
    const uniqueCommands = new Map<string, SlashCommandHandler>()
    this.commands.forEach((handler) => {
      uniqueCommands.set(handler.name, handler)
    })
    return Array.from(uniqueCommands.values())
  }

  /**
   * Search commands
   * @param query Full query (e.g., "/theme dark" or "/lang en")
   * @param locale Current language
   */
  async search(query: string, locale: string = 'en'): Promise<CommandSearchResult[]> {
    const trimmed = query.trim()

    // Handle root level search "/"
    if (trimmed === '/' || !trimmed.replace('/', '').trim())
      return await this.getRootCommands()

    // Parse command and arguments
    const afterSlash = trimmed.substring(1).trim()
    const spaceIndex = afterSlash.indexOf(' ')
    const commandName = spaceIndex === -1 ? afterSlash : afterSlash.substring(0, spaceIndex)
    const args = spaceIndex === -1 ? '' : afterSlash.substring(spaceIndex + 1).trim()

    // First try exact match
    let handler = this.findCommand(commandName)
    if (handler) {
      try {
        return await handler.search(args, locale)
      }
      catch (error) {
        console.warn(`Command search failed for ${commandName}:`, error)
        return []
      }
    }

    // If no exact match, try smart partial matching
    handler = this.findBestPartialMatch(commandName)
    if (handler) {
      try {
        return await handler.search(args, locale)
      }
      catch (error) {
        console.warn(`Command search failed for ${handler.name}:`, error)
        return []
      }
    }

    // Finally perform fuzzy search
    return this.fuzzySearchCommands(afterSlash)
  }

  /**
   * Get root level command list
   */
  private async getRootCommands(): Promise<CommandSearchResult[]> {
    const results: CommandSearchResult[] = []

    // Generate a root level item for each command
    for (const handler of this.getAllCommands()) {
      results.push({
        id: `root-${handler.name}`,
        title: `/${handler.name}`,
        description: handler.description,
        type: 'command' as const,
        data: {
          command: `root.${handler.name}`,
          args: { name: handler.name },
        },
      })
    }

    return results
  }

  /**
   * Fuzzy search commands
   */
  private fuzzySearchCommands(query: string): CommandSearchResult[] {
    const lowercaseQuery = query.toLowerCase()
    const matches: CommandSearchResult[] = []

    this.getAllCommands().forEach((handler) => {
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
    })

    return matches
  }

  /**
   * Get command dependencies
   */
  getCommandDependencies(commandName: string): any {
    return this.commandDeps.get(commandName)
  }
}

// Global registry instance
export const slashCommandRegistry = new SlashCommandRegistry()
