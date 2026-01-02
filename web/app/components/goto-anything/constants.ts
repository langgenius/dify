/**
 * Goto Anything Constants
 * Centralized constants for action keys
 */

/**
 * Action keys for scope-based searches
 */
export const ACTION_KEYS = {
  APP: '@app',
  KNOWLEDGE: '@knowledge',
  PLUGIN: '@plugin',
  NODE: '@node',
  SLASH: '/',
} as const

/**
 * Type-safe action key union type
 */
export type ActionKey = typeof ACTION_KEYS[keyof typeof ACTION_KEYS]
