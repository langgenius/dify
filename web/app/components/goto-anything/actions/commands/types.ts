import type { CommandSearchResult } from '../types'
import type { Locale } from '@/i18n-config/language'

/**
 * Slash command handler interface
 * Each slash command should implement this interface
 */
export type SlashCommandHandler<TDeps = unknown> = {
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
   * Check if command is available in current context
   * If not implemented, command is always available
   * Used to conditionally show/hide commands based on page, user state, etc.
   */
  isAvailable?: () => boolean

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

/**
 * Theme command dependencies
 */
export type ThemeCommandDeps = {
  setTheme?: (value: 'light' | 'dark' | 'system') => void
}

/**
 * Language command dependencies
 */
export type LanguageCommandDeps = {
  setLocale?: (locale: Locale, reloadPage?: boolean) => Promise<void>
}

/**
 * Commands without external dependencies
 */
export type NoDepsCommandDeps = Record<string, never>

/**
 * Union type of all slash command dependencies
 * Used for type-safe dependency injection in registerSlashCommands
 */
export type SlashCommandDependencies = {
  setTheme?: (value: 'light' | 'dark' | 'system') => void
  setLocale?: (locale: Locale, reloadPage?: boolean) => Promise<void>
}
