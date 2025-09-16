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
   * Command mode:
   * - 'direct': Execute immediately when selected (e.g., /docs, /community)
   * - 'submenu': Show submenu options (e.g., /theme, /language)
   */
  mode?: 'direct' | 'submenu'

  /**
   * Direct execution function for 'direct' mode commands
   * Called when the command is selected and should execute immediately
   */
  execute?: () => void | Promise<void>

  /**
   * Search command results (for 'submenu' mode or showing options)
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
