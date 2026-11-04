import type { CommandContext } from './actions/commands/types'
import type { ActionItem, CommandSearchResult, SearchResult } from './actions/types'
import { useTranslation } from 'react-i18next'
import { MAIN_NAV_ROUTES } from '@/app/components/main-nav/routes'
import { slashCommandRegistry } from './actions/commands/catalog'

export type CommandOption = {
  kind: 'command-option'
  shortcut: string
  title: string
  description?: string
  icon: string
  result?: CommandSearchResult
}

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

const scopeDescriptions = {
  '@app': 'gotoAnything.actions.searchApplicationsDesc',
  '@knowledge': 'gotoAnything.actions.searchKnowledgeBasesDesc',
  '@plugin': 'gotoAnything.actions.searchPluginsDesc',
  '@node': 'gotoAnything.actions.searchWorkflowNodesDesc',
} as const

const featuredCommands = ['refine', 'create', 'models', 'go', 'theme']

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
  const scopeOptions: CommandOption[] = Object.values(actions).flatMap((action) => {
    if (action.key === '/') return []
    const routeKey = scopeRoutes[action.key as keyof typeof scopeRoutes]
    const descriptionKey = scopeDescriptions[action.key as keyof typeof scopeDescriptions]
    const option: CommandOption = {
      kind: 'command-option',
      shortcut: action.shortcut,
      title: scopeTitles[action.key],
      description: descriptionKey ? t(($) => $[descriptionKey], { ns: 'app' }) : action.description,
      icon: MAIN_NAV_ROUTES.find((route) => route.key === routeKey)?.icon ?? 'i-ri-node-tree',
    }
    return !trimmed || matches(filter, [option.title, option.shortcut, action.key]) ? [option] : []
  })

  if (trimmed.startsWith('@')) return { scopeOptions, commandOptions: [] }

  const commandOptions = commands.flatMap<CommandOption>((command) => {
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
      description:
        command.name === 'models'
          ? t(($) => $['modelProvider.systemModelSettingsDesc'], { ns: 'modelProvider' })
          : undefined,
      icon: presentation?.[1] ?? 'i-ri-brain-2-line',
    }
    if (
      !filter ||
      matches(filter, [option.title, option.description, command.name, ...(command.aliases ?? [])])
    )
      return [option]
    if (trimmed.startsWith('/') || command.mode === 'direct') return []

    return slashCommandRegistry
      .search(`/${command.name}`, context)
      .filter((result) => matches(filter, [result.title, result.description, result.id]))
      .map((result) => ({
        ...option,
        title: result.title,
        description: option.title,
        result,
      }))
  })

  if (!trimmed) {
    const featured = featuredCommands
      .flatMap((name) => commandOptions.filter((option) => option.shortcut === `/${name}`))
      .slice(0, 3)
    return {
      scopeOptions,
      commandOptions: [
        ...featured,
        {
          kind: 'command-option' as const,
          shortcut: '/',
          title: t(($) => $['gotoAnything.allCommands'], { ns: 'app' }),
          icon: 'i-ri-terminal-box-line',
        },
      ],
    }
  }

  return { scopeOptions, commandOptions }
}
