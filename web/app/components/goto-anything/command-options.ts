import type { CommandContext } from './actions/commands/types'
import type { ActionItem, CommandSearchResult, SearchResult } from './actions/types'
import { useTranslation } from 'react-i18next'
import { MAIN_NAV_ROUTES } from '@/app/components/main-nav/routes'
import { slashCommandRegistry } from './actions/commands/catalog'

export type SearchScope = Exclude<ActionItem['key'], '/'>

export type ScopeSelection = SearchScope | 'all'

export type CommandOption = {
  kind: 'command-option'
  shortcut: string
  title: string
  description?: string
  icon: string
  opensPage?: boolean
  scope?: SearchScope
  result?: CommandSearchResult
}

export type ScopeOption = CommandOption & { scope: SearchScope }

export type GotoAnythingOption = CommandOption | SearchResult

export function isCommandOption(option: GotoAnythingOption): option is CommandOption {
  return 'kind' in option && option.kind === 'command-option'
}

const commandPresentation = {
  create: ['gotoAnything.actions.createCategoryDesc', 'i-ri-sparkling-2-line'],
  refine: ['gotoAnything.actions.refineTitle', 'i-ri-magic-line'],
  theme: ['gotoAnything.actions.themeCategoryDesc', 'i-ri-contrast-2-line'],
  language: ['gotoAnything.actions.languageChangeDesc', 'i-ri-translate-2'],
  account: ['gotoAnything.actions.accountDesc', 'i-ri-user-line'],
  docs: ['gotoAnything.actions.docDesc', 'i-ri-book-open-line'],
  discord: ['gotoAnything.actions.discordDesc', 'i-ri-discord-line'],
  go: ['gotoAnything.actions.goDesc', 'i-ri-compass-3-line'],
} as const

const scopeRoutes = {
  '@app': 'apps',
  '@knowledge': 'datasets',
  '@plugin': 'marketplace',
  '@skill': 'skills',
  '@agents': 'roster',
} as const

const featuredCommands = ['refine', 'create', 'go', 'models', 'theme', 'language']

function commandRank(name: string) {
  const rank = featuredCommands.indexOf(name)
  return rank === -1 ? featuredCommands.length : rank
}

function matches(query: string, values: (string | undefined)[]) {
  const text = values.filter(Boolean).join(' ').toLocaleLowerCase()
  return query
    .toLocaleLowerCase()
    .split(/\s+/)
    .every((term) => text.includes(term))
}

export function useCommandOptions(
  actions: Record<string, ActionItem>,
  query: string,
  context: CommandContext,
) {
  const { t } = useTranslation(['app', 'common', 'skill', 'modelProvider', 'agentRoster'])
  const commands = slashCommandRegistry.getAvailableCommands(context)
  const trimmed = query.trim()
  const filter = trimmed.replace(/^[@/]/, '')

  const scopeTitles = {
    '@app': t(($) => $['gotoAnything.groups.apps'], { ns: 'app' }),
    '@knowledge': t(($) => $['gotoAnything.groups.knowledgeBases'], { ns: 'app' }),
    '@plugin': t(($) => $['gotoAnything.groups.plugins'], { ns: 'app' }),
    '@node': t(($) => $['gotoAnything.groups.workflowNodes'], { ns: 'app' }),
    '@skill': t(($) => $['skillManagement.title'], { ns: 'skill' }),
    '@agents': t(($) => $['roster.title'], { ns: 'agentRoster' }),
  }
  const allScopeOptions: ScopeOption[] = Object.values(actions).flatMap((action) => {
    if (action.key === '/') return []
    const routeKey = scopeRoutes[action.key as keyof typeof scopeRoutes]
    return [
      {
        kind: 'command-option',
        shortcut: action.shortcut,
        title: scopeTitles[action.key],
        icon: MAIN_NAV_ROUTES.find((route) => route.key === routeKey)?.icon ?? 'i-ri-node-tree',
        scope: action.key,
      },
    ]
  })
  const scopeOptions = trimmed
    ? allScopeOptions.filter((option) =>
        matches(filter, [option.title, option.shortcut, option.scope]),
      )
    : allScopeOptions

  const commandEntries = commands
    .map((command) => {
      const presentation = commandPresentation[command.name as keyof typeof commandPresentation]
      const option: CommandOption = {
        kind: 'command-option',
        shortcut: `/${command.name}`,
        title:
          command.name === 'models'
            ? t(($) => $['modelProvider.systemModelSettings'], { ns: 'modelProvider' })
            : presentation
              ? t(($) => $[presentation[0]], { ns: 'app' })
              : command.description,
        icon: presentation?.[1] ?? 'i-ri-brain-2-line',
        opensPage: command.mode === 'submenu',
      }
      return { command, option }
    })
    .sort((a, b) => commandRank(a.command.name) - commandRank(b.command.name))
  const allCommandOptions = commandEntries.map(({ option }) => option)
  const result = { scopeOptions, allScopeOptions, allCommandOptions }

  if (trimmed.startsWith('@')) return { ...result, commandOptions: [] }

  const commandOptions = commandEntries.flatMap<CommandOption>(({ command, option }) => {
    if (
      !filter ||
      matches(filter, [option.title, option.description, command.name, ...(command.aliases ?? [])])
    )
      return [option]
    if (trimmed.startsWith('/') || command.mode === 'direct') return []

    return slashCommandRegistry
      .search(`/${command.name}`, context)
      .filter((match) => matches(filter, [match.title, match.description, match.id]))
      .map((match) => ({
        ...option,
        title: match.title,
        description: option.title,
        opensPage: false,
        result: match,
      }))
  })

  return { ...result, commandOptions }
}
