import type { CommandSearchResult } from '../types'

/**
 * Slash command handler interface
 * Each slash command should implement this interface
 */
export type SlashCommandHandler<TDeps = any> = {
  /** Command name (e.g., 'theme', 'language') */
  name: string

  /** Command alias list (e.g., ['lang'] for language) */
  aliases?: string[]

  /** Command description */
  description: string

  /**
   * Search command results
   * @param args Command arguments (part after removing command name)
   * @param locale Current language
   */
  search: (args: string, locale?: string) => Promise<CommandSearchResult[]>

  /**
   * Called when registering command, passing external dependencies
   */
  register?: (deps: TDeps) => void

  /**
   * Called when unregistering command
   */
  unregister?: () => void
}
