/**
 * Goto Anything Constants
 * Centralized constants for action keys, command mappings, and i18n keys
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

/**
 * Slash command i18n key mappings
 * Maps slash command keys to their corresponding i18n translation keys
 */
export const SLASH_COMMAND_I18N_MAP: Record<string, string> = {
  '/theme': 'app.gotoAnything.actions.themeCategoryDesc',
  '/language': 'app.gotoAnything.actions.languageChangeDesc',
  '/account': 'app.gotoAnything.actions.accountDesc',
  '/feedback': 'app.gotoAnything.actions.feedbackDesc',
  '/docs': 'app.gotoAnything.actions.docDesc',
  '/community': 'app.gotoAnything.actions.communityDesc',
  '/zen': 'app.gotoAnything.actions.zenDesc',
  '/banana': 'app.gotoAnything.actions.vibeDesc',
} as const

/**
 * Scope action i18n key mappings
 * Maps scope action keys to their corresponding i18n translation keys
 */
export const SCOPE_ACTION_I18N_MAP: Record<string, string> = {
  '@app': 'app.gotoAnything.actions.searchApplicationsDesc',
  '@plugin': 'app.gotoAnything.actions.searchPluginsDesc',
  '@knowledge': 'app.gotoAnything.actions.searchKnowledgeBasesDesc',
  '@node': 'app.gotoAnything.actions.searchWorkflowNodesDesc',
} as const

/**
 * Empty state i18n key mappings
 */
export const EMPTY_STATE_I18N_MAP: Record<string, string> = {
  app: 'app.gotoAnything.emptyState.noAppsFound',
  plugin: 'app.gotoAnything.emptyState.noPluginsFound',
  knowledge: 'app.gotoAnything.emptyState.noKnowledgeBasesFound',
  node: 'app.gotoAnything.emptyState.noWorkflowNodesFound',
} as const

/**
 * Group heading i18n key mappings
 */
export const GROUP_HEADING_I18N_MAP: Record<string, string> = {
  'app': 'app.gotoAnything.groups.apps',
  'plugin': 'app.gotoAnything.groups.plugins',
  'knowledge': 'app.gotoAnything.groups.knowledgeBases',
  'workflow-node': 'app.gotoAnything.groups.workflowNodes',
  'command': 'app.gotoAnything.groups.commands',
} as const
