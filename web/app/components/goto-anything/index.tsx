'use client'

import type { AutocompleteChangeEventDetails } from '@langgenius/dify-ui/autocomplete'
import type { Plugin } from '../plugins/types'
import type { ActionItem, SearchResult } from './actions/types'
import {
  Autocomplete,
  AutocompleteCollection,
  AutocompleteGroup,
  AutocompleteGroupLabel,
  AutocompleteInput,
  AutocompleteInputGroup,
  AutocompleteItem,
  AutocompleteList,
  AutocompleteRow,
  AutocompleteStatus,
} from '@langgenius/dify-ui/autocomplete'
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogPopup,
  DialogPortal,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Kbd, KbdGroup } from '@langgenius/dify-ui/kbd'
import {
  ScrollArea,
  ScrollAreaContent,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '@langgenius/dify-ui/scroll-area'
import { formatForDisplay, useHotkey } from '@tanstack/react-hotkeys'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useDebouncedValue } from 'foxact/use-debounced-value'
import { useAtomValue } from 'jotai'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MAIN_NAV_ROUTES } from '@/app/components/main-nav/routes'
import { selectWorkflowNode } from '@/app/components/workflow/utils/node-navigation'
import { useGetLanguage } from '@/context/i18n'
import { useProviderContextSelector } from '@/context/provider-context'
import { isCurrentWorkspaceDatasetOperatorAtom } from '@/context/workspace-state'
import { isAgentV2Enabled } from '@/features/agent-v2/feature-flag'
import { useCanManageAgents } from '@/features/agent-v2/permissions'
import { usePathname, useRouter } from '@/next/navigation'
import { PluginInstallPermissionProvider } from '../plugins/install-plugin/components/plugin-install-permission-provider'
import useWorkspacePluginInstallPermission from '../plugins/install-plugin/hooks/use-workspace-plugin-install-permission'
import InstallFromMarketplace from '../plugins/install-plugin/install-from-marketplace'
import { createActions, getActionSearchTerm, matchAction } from './actions'
import { agentSearchQueryOptions } from './actions/agent'
import { appSearchQueryOptions } from './actions/app'
import { slashCommandRegistry } from './actions/commands/registry'
import { SlashCommandProvider } from './actions/commands/slash-provider'
import { knowledgeSearchQueryOptions } from './actions/knowledge'
import { pluginSearchQueryOptions } from './actions/plugin'
import { skillSearchQueryOptions } from './actions/skill'
import { EmptyState } from './components/empty-state'
import { Footer } from './components/footer'
import { gotoAnythingDialogHandle } from './dialog-handle'
import { GOTO_ANYTHING_HOTKEY } from './hotkeys'

const appWorkflowPathPattern = /^\/app\/[^/]+\/workflow$/
const sharedWorkflowPathPattern = /^\/workflow\/[^/]+$/
const ragPipelinePathPattern = /^\/datasets\/[^/]+\/pipeline$/

type CommandOption = {
  kind: 'command-option'
  shortcut: string
  description: string
  icon: string
}

type GotoAnythingOption = CommandOption | SearchResult

const slashCommandDescriptionKeys = {
  '/create': 'gotoAnything.actions.createCategoryDesc',
  '/refine': 'gotoAnything.actions.refineCategoryDesc',
  '/theme': 'gotoAnything.actions.themeCategoryDesc',
  '/language': 'gotoAnything.actions.languageChangeDesc',
  '/account': 'gotoAnything.actions.accountDesc',
  '/docs': 'gotoAnything.actions.docDesc',
  '/discord': 'gotoAnything.actions.discordDesc',
} as const

const actionDescriptionKeys = {
  '@app': 'gotoAnything.actions.searchApplicationsDesc',
  '@plugin': 'gotoAnything.actions.searchPluginsDesc',
  '@kb': 'gotoAnything.actions.searchKnowledgeBasesDesc',
  '@node': 'gotoAnything.actions.searchWorkflowNodesDesc',
} as const

const groupLabelKeys = {
  app: 'gotoAnything.groups.apps',
  plugin: 'gotoAnything.groups.plugins',
  knowledge: 'gotoAnything.groups.knowledgeBases',
  'workflow-node': 'gotoAnything.groups.workflowNodes',
  command: 'gotoAnything.groups.commands',
} as const

type MainNavRouteKey = (typeof MAIN_NAV_ROUTES)[number]['key']

const scopeMainNavRouteKeys = {
  '@app': 'apps',
  '@knowledge': 'datasets',
  '@plugin': 'marketplace',
  '@skill': 'skills',
  '@agents': 'roster',
} as const satisfies Partial<Record<ActionItem['key'], MainNavRouteKey>>

function getScopeCardIcon(action: ActionItem) {
  const routeKey = scopeMainNavRouteKeys[action.key as keyof typeof scopeMainNavRouteKeys]
  if (!routeKey) return 'i-ri-node-tree'

  return MAIN_NAV_ROUTES.find((route) => route.key === routeKey)?.icon ?? 'i-ri-node-tree'
}

function getCommandOptions(actions: Record<string, ActionItem>, query: string): CommandOption[] {
  const trimmedQuery = query.trim()
  const filter = trimmedQuery.slice(1).toLowerCase()

  if (trimmedQuery.startsWith('/')) {
    return slashCommandRegistry
      .getAvailableCommands()
      .filter((command) => !filter || command.name.toLowerCase().includes(filter))
      .map((command) => ({
        kind: 'command-option',
        shortcut: `/${command.name}`,
        description: command.description,
        icon: 'i-ri-terminal-box-line',
      }))
  }

  return Object.values(actions)
    .filter((action) => action.key !== '/')
    .filter((action) => !filter || action.shortcut.toLowerCase().includes(filter))
    .map((action) => ({
      kind: 'command-option',
      shortcut: action.shortcut,
      description: action.description,
      icon: getScopeCardIcon(action),
    }))
}

function isCommandOption(option: GotoAnythingOption): option is CommandOption {
  return 'kind' in option && option.kind === 'command-option'
}

function optionToInputValue(option: GotoAnythingOption) {
  return isCommandOption(option) ? `${option.shortcut} ` : option.title
}

function isEditableShortcutTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false

  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

function getSearchMode(
  searchQuery: string,
  isCommandsMode: boolean,
  actions: Record<string, ActionItem>,
) {
  if (isCommandsMode) return searchQuery.trim().startsWith('/') ? 'commands' : 'scopes'

  const action = matchAction(searchQuery.trimStart().toLowerCase(), actions)
  if (!action) return 'general'

  return action.key === '/' ? '@command' : action.key
}

function isCommandSelectionQuery(query: string, actions: Record<string, ActionItem>) {
  const trimmedQuery = query.trim()
  if (!trimmedQuery || trimmedQuery === '@' || trimmedQuery === '/') return true

  return (
    (trimmedQuery.startsWith('@') || trimmedQuery.startsWith('/')) &&
    !matchAction(query.trimStart().toLowerCase(), actions)
  )
}

function getActionIdentity(query: string, action: ActionItem) {
  if (action.key !== '/') return action.key
  return query.split(/\s/, 1)[0]
}

function getActionBaseQuery(query: string, action: ActionItem) {
  if (action.key === '/') return `${getActionIdentity(query, action)} `
  return `${query.split(/\s/, 1)[0] ?? action.shortcut} `
}

function getRemoteSearchIdentity(
  query: string,
  isCommandsMode: boolean,
  action: ActionItem | undefined,
) {
  if (!query.trim() || isCommandsMode || action?.source === 'local') return null
  return action?.key ?? 'general'
}

function dedupeSearchResults(results: SearchResult[]) {
  const seen = new Set<string>()
  return results.filter((result) => {
    const key = `${result.type}-${result.id}`
    if (seen.has(key)) return false

    seen.add(key)
    return true
  })
}

function groupSearchResults(results: SearchResult[]) {
  return results.reduce<Record<string, SearchResult[]>>((groups, result) => {
    const group = groups[result.type] ?? []
    group.push(result)
    groups[result.type] = group
    return groups
  }, {})
}

function chunkArray<T>(items: readonly T[], size: number): T[][] {
  const rows: T[][] = []
  for (let index = 0; index < items.length; index += size)
    rows.push(items.slice(index, index + size))
  return rows
}

function GotoAnythingDialog() {
  const { t } = useTranslation()
  const pathname = usePathname()
  const router = useRouter()
  const defaultLocale = useGetLanguage()
  const canManageAgents = useCanManageAgents()
  const isCurrentWorkspaceDatasetOperator = useAtomValue(isCurrentWorkspaceDatasetOperatorAtom)
  const enableSkill = useProviderContextSelector((state) => state.enableSkill)
  const agentsAvailable = isAgentV2Enabled() && canManageAgents
  const skillsAvailable = enableSkill && !isCurrentWorkspaceDatasetOperator
  const isWorkflowPage =
    appWorkflowPathPattern.test(pathname) || sharedWorkflowPathPattern.test(pathname)
  const isRagPipelinePage = ragPipelinePathPattern.test(pathname)
  const { canInstallPlugin, currentDifyVersion } = useWorkspacePluginInstallPermission()
  const [searchQuery, setSearchQuery] = useState('')
  const [activePlugin, setActivePlugin] = useState<Plugin>()
  const inputRef = useRef<HTMLInputElement>(null)
  const actions = useMemo(
    () =>
      createActions(isWorkflowPage, isRagPipelinePage, {
        agents: agentsAvailable,
        skills: skillsAvailable,
      }),
    [agentsAvailable, isWorkflowPage, isRagPipelinePage, skillsAvailable],
  )
  const trimmedSearchQuery = searchQuery.trim()
  const normalizedSearchQuery = searchQuery.trimStart().toLowerCase()
  const isCommandsMode = isCommandSelectionQuery(searchQuery, actions)
  const searchMode = getSearchMode(searchQuery, isCommandsMode, actions)
  const currentAction = matchAction(normalizedSearchQuery, actions)
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 300)
  const normalizedDebouncedQuery = debouncedSearchQuery.trimStart().toLowerCase()
  const isDebouncedCommandsMode = isCommandSelectionQuery(debouncedSearchQuery, actions)
  const debouncedAction = matchAction(normalizedDebouncedQuery, actions)
  const debouncedSearchTerm = debouncedAction
    ? getActionSearchTerm(normalizedDebouncedQuery, debouncedAction)
    : normalizedDebouncedQuery.trimEnd()
  const remoteSearchEnabled = Boolean(normalizedDebouncedQuery.trim()) && !isDebouncedCommandsMode
  const appSearchEnabled =
    remoteSearchEnabled && (!debouncedAction || debouncedAction.key === '@app')
  const knowledgeSearchEnabled =
    remoteSearchEnabled && (!debouncedAction || debouncedAction.key === '@knowledge')
  const pluginSearchEnabled =
    remoteSearchEnabled && (!debouncedAction || debouncedAction.key === '@plugin')
  const skillSearchEnabled =
    remoteSearchEnabled && skillsAvailable && (!debouncedAction || debouncedAction.key === '@skill')
  const agentSearchEnabled =
    remoteSearchEnabled &&
    agentsAvailable &&
    (!debouncedAction || debouncedAction.key === '@agents')
  const appSearchQuery = useQuery({
    ...appSearchQueryOptions(debouncedSearchTerm, debouncedAction?.key === '@app'),
    enabled: appSearchEnabled,
    placeholderData: keepPreviousData,
  })
  const knowledgeSearchQuery = useQuery({
    ...knowledgeSearchQueryOptions(debouncedSearchTerm),
    enabled: knowledgeSearchEnabled,
    placeholderData: keepPreviousData,
  })
  const pluginSearchQuery = useQuery({
    ...pluginSearchQueryOptions(debouncedSearchTerm, defaultLocale),
    enabled: pluginSearchEnabled,
    placeholderData: keepPreviousData,
  })
  const skillSearchQuery = useQuery({
    ...skillSearchQueryOptions(debouncedSearchTerm),
    enabled: skillSearchEnabled,
    placeholderData: keepPreviousData,
  })
  const agentSearchQuery = useQuery({
    ...agentSearchQueryOptions(debouncedSearchTerm),
    enabled: agentSearchEnabled,
    placeholderData: keepPreviousData,
  })
  const isSameLocalAction =
    currentAction?.source === 'local' &&
    debouncedAction?.source === 'local' &&
    getActionIdentity(normalizedSearchQuery, currentAction) ===
      getActionIdentity(normalizedDebouncedQuery, debouncedAction)
  const isLocalSearchDebouncing =
    currentAction?.source === 'local' && normalizedSearchQuery !== normalizedDebouncedQuery
  const isSameGeneralSearch =
    currentAction === undefined &&
    debouncedAction === undefined &&
    !isCommandsMode &&
    !isDebouncedCommandsMode &&
    Boolean(normalizedSearchQuery.trim()) &&
    Boolean(normalizedDebouncedQuery.trim())
  let localSearchQuery = normalizedSearchQuery
  if (isSameLocalAction || isSameGeneralSearch) localSearchQuery = normalizedDebouncedQuery
  else if (isLocalSearchDebouncing)
    localSearchQuery = getActionBaseQuery(normalizedSearchQuery, currentAction)
  const localSearchResults = useMemo(() => {
    if (!trimmedSearchQuery || isCommandsMode) return []

    const action = matchAction(localSearchQuery, actions)
    if (action?.source === 'local') {
      return action.search(
        localSearchQuery,
        getActionSearchTerm(localSearchQuery, action),
        defaultLocale,
      )
    }
    if (action) return []

    return Object.values(actions).flatMap((candidate) => {
      if (candidate.source !== 'local' || candidate.key === '/') return []
      const generalSearchTerm = localSearchQuery.trimEnd()
      return candidate.search(generalSearchTerm, generalSearchTerm, defaultLocale)
    })
  }, [actions, defaultLocale, isCommandsMode, localSearchQuery, trimmedSearchQuery])
  const debouncedRemoteQueries = [
    appSearchEnabled ? appSearchQuery : undefined,
    knowledgeSearchEnabled ? knowledgeSearchQuery : undefined,
    pluginSearchEnabled ? pluginSearchQuery : undefined,
    skillSearchEnabled ? skillSearchQuery : undefined,
    agentSearchEnabled ? agentSearchQuery : undefined,
  ].filter((query) => query !== undefined)
  const currentRemoteSearchIdentity = getRemoteSearchIdentity(
    normalizedSearchQuery,
    isCommandsMode,
    currentAction,
  )
  const debouncedRemoteSearchIdentity = getRemoteSearchIdentity(
    normalizedDebouncedQuery,
    isDebouncedCommandsMode,
    debouncedAction,
  )
  const isSameRemoteSearch =
    currentRemoteSearchIdentity !== null &&
    currentRemoteSearchIdentity === debouncedRemoteSearchIdentity
  const currentRemoteQueries = isSameRemoteSearch ? debouncedRemoteQueries : []
  const isRemoteSearchDebouncing =
    currentRemoteSearchIdentity !== null && normalizedSearchQuery !== normalizedDebouncedQuery
  const isDebouncing = isRemoteSearchDebouncing || isLocalSearchDebouncing
  const isLoading =
    isDebouncing || currentRemoteQueries.some((query) => query.isLoading || query.isFetching)
  const failedRemoteQueries = currentRemoteQueries.filter((query) => query.isError)
  const isError =
    currentRemoteQueries.length > 0 && failedRemoteQueries.length === currentRemoteQueries.length
  const hasUnavailableServices = failedRemoteQueries.length > 0
  const queryError = failedRemoteQueries[0]?.error
  const error = queryError instanceof Error ? queryError : null
  const remoteSearchResults = currentRemoteQueries.flatMap((query) => query.data ?? [])
  const searchResults = [...localSearchResults, ...remoteSearchResults]
  const dedupedResults = dedupeSearchResults(searchResults)
  const groupedResults = groupSearchResults(dedupedResults)

  function resetSearch() {
    setSearchQuery('')
  }

  useHotkey(
    GOTO_ANYTHING_HOTKEY,
    (event) => {
      if (event.defaultPrevented) return
      if (!gotoAnythingDialogHandle.isOpen && isEditableShortcutTarget(event.target)) return

      event.preventDefault()
      event.stopPropagation()

      if (!gotoAnythingDialogHandle.isOpen) gotoAnythingDialogHandle.open(null)
    },
    {
      ignoreInputs: false,
      preventDefault: false,
      stopPropagation: false,
    },
  )

  function handleCommandSelect(commandKey: string) {
    if (commandKey.startsWith('/')) {
      const handler = slashCommandRegistry.findCommand(commandKey.slice(1))
      if (handler?.mode === 'direct' && handler.execute) {
        handler.execute()
        gotoAnythingDialogHandle.close()
        return
      }
    }

    setSearchQuery(`${commandKey} `)
  }

  function handleNavigate(result: SearchResult) {
    gotoAnythingDialogHandle.close()

    switch (result.type) {
      case 'command':
        actions.slash.action?.(result)
        break
      case 'plugin':
        setActivePlugin(result.data)
        break
      case 'workflow-node':
        if (result.metadata?.nodeId) selectWorkflowNode(result.metadata.nodeId, true)
        break
      default:
        if (result.path) router.push(result.path)
    }
  }

  function handleAutocompleteOpenChange(
    nextOpen: boolean,
    eventDetails: AutocompleteChangeEventDetails,
  ) {
    if (!nextOpen && eventDetails.reason === 'escape-key') gotoAnythingDialogHandle.close()
  }

  function handleAutocompleteValueChange(
    nextValue: string,
    eventDetails: AutocompleteChangeEventDetails,
  ) {
    if (eventDetails.reason !== 'item-press') setSearchQuery(nextValue)
  }

  function selectOption(option: GotoAnythingOption) {
    if (isCommandOption(option)) handleCommandSelect(option.shortcut)
    else handleNavigate(option)
  }

  const isSlashMode = searchQuery.trim().startsWith('/')

  function getCommandOptionDescription(option: CommandOption) {
    if (option.shortcut === '/models')
      return t(($) => $['modelProvider.systemModelSettingsDesc'], { ns: 'common' })

    const descriptionKey = isSlashMode
      ? slashCommandDescriptionKeys[option.shortcut as keyof typeof slashCommandDescriptionKeys]
      : actionDescriptionKeys[option.shortcut as keyof typeof actionDescriptionKeys]

    if (!descriptionKey) return option.description

    return t(($) => $[descriptionKey], { ns: 'app' })
  }

  function getGroupLabel(type: string) {
    if (type === 'skill') return t(($) => $['skillManagement.title'], { ns: 'skill' })
    if (type === 'agent') return t(($) => $['roster.title'], { ns: 'agentV2' })

    return t(($) => $[groupLabelKeys[type as keyof typeof groupLabelKeys] || `${type}s`], {
      ns: 'app',
    })
  }

  const commandOptions = getCommandOptions(actions, searchQuery)
  const autocompleteOptions: GotoAnythingOption[] = isCommandsMode ? commandOptions : dedupedResults
  const visibleOptions = isError ? [] : autocompleteOptions
  const autocompleteResultCount = visibleOptions.length
  const commandRows = chunkArray(commandOptions, 2)

  let autocompleteStatus: string | null = null
  if (isLoading) autocompleteStatus = t(($) => $['gotoAnything.searching'], { ns: 'app' })
  else if (isError) autocompleteStatus = t(($) => $['gotoAnything.searchFailed'], { ns: 'app' })
  else if (hasUnavailableServices)
    autocompleteStatus = t(($) => $['gotoAnything.someServicesUnavailable'], { ns: 'app' })
  else if (trimmedSearchQuery)
    autocompleteStatus = t(($) => $['gotoAnything.resultCount'], {
      ns: 'app',
      count: autocompleteResultCount,
    })

  let emptyStateVariant: 'loading' | 'error' | 'no-results' | null = null
  if (isLoading && autocompleteResultCount === 0) emptyStateVariant = 'loading'
  else if (isError) emptyStateVariant = 'error'
  else if (autocompleteResultCount === 0 && !isCommandsMode) emptyStateVariant = 'no-results'

  return (
    <>
      <SlashCommandProvider />
      <Dialog handle={gotoAnythingDialogHandle} onOpenChange={resetSearch}>
        <DialogPortal>
          <DialogBackdrop />
          <DialogPopup
            initialFocus={inputRef}
            className="fixed top-1/2 left-1/2 isolate max-h-[80dvh] w-160! max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-hidden p-0!"
          >
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-[url('/marketplace/hero-gradient-noise.svg')] bg-cover bg-center opacity-18 dark:opacity-28"
            />
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-linear-to-b from-components-panel-bg/20 via-components-panel-bg/70 to-components-panel-bg"
            />
            <DialogTitle className="sr-only">
              {t(($) => $['gotoAnything.searchTitle'], { ns: 'app' })}
            </DialogTitle>
            <Autocomplete<GotoAnythingOption>
              items={visibleOptions}
              value={searchQuery}
              onValueChange={handleAutocompleteValueChange}
              onOpenChange={handleAutocompleteOpenChange}
              itemToStringValue={optionToInputValue}
              filter={null}
              grid={isCommandsMode}
              open
              inline
              autoHighlight="always"
              keepHighlight
              loopFocus
            >
              <AutocompleteInputGroup
                size="medium"
                className="h-auto gap-3 rounded-none border-0 border-b border-divider-subtle bg-components-panel-bg-blur px-4 py-3 shadow-none focus-within:border-divider-subtle focus-within:bg-components-panel-bg-blur focus-within:shadow-none hover:border-divider-subtle hover:bg-components-panel-bg-blur data-focused:border-divider-subtle data-focused:bg-components-panel-bg-blur data-focused:shadow-none"
              >
                <span aria-hidden className="i-ri-search-line size-4 text-text-quaternary" />
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <AutocompleteInput
                    ref={inputRef}
                    size="medium"
                    aria-label={t(($) => $['gotoAnything.searchTitle'], { ns: 'app' })}
                    placeholder={t(($) => $['gotoAnything.searchPlaceholder'], { ns: 'app' })}
                    className="px-0"
                  />
                </div>
                <KbdGroup>
                  {GOTO_ANYTHING_HOTKEY.split('+').map((key) => (
                    <Kbd key={key}>{formatForDisplay(key)}</Kbd>
                  ))}
                </KbdGroup>
              </AutocompleteInputGroup>

              <AutocompleteStatus className="sr-only">{autocompleteStatus}</AutocompleteStatus>

              <ScrollArea className="relative h-88 min-h-0 overflow-hidden">
                <ScrollAreaViewport
                  aria-busy={isLoading || undefined}
                  className="scroll-py-1 overscroll-contain"
                >
                  <ScrollAreaContent
                    className="min-h-full w-full max-w-full"
                    style={{ minWidth: '100%' }}
                  >
                    {emptyStateVariant === 'loading' && <EmptyState variant="loading" />}

                    {emptyStateVariant === 'error' && <EmptyState variant="error" error={error} />}

                    {!isLoading && !isError && isCommandsMode && autocompleteResultCount === 0 && (
                      <div className="flex items-center justify-center py-8 text-center text-text-tertiary">
                        <div>
                          <div className="text-sm font-medium text-text-tertiary">
                            {t(($) => $['gotoAnything.noMatchingCommands'], { ns: 'app' })}
                          </div>
                          <div className="mt-1 text-xs text-text-quaternary">
                            {t(($) => $['gotoAnything.tryDifferentSearch'], { ns: 'app' })}
                          </div>
                        </div>
                      </div>
                    )}

                    {!isLoading && !isError && !isCommandsMode && emptyStateVariant && (
                      <EmptyState
                        variant={emptyStateVariant}
                        searchMode={searchMode}
                        actions={actions}
                      />
                    )}

                    <AutocompleteList className="max-h-none overflow-visible p-0">
                      {!isLoading && !isError && isCommandsMode && autocompleteResultCount > 0 && (
                        <AutocompleteGroup items={commandOptions} role="rowgroup">
                          <AutocompleteGroupLabel className="px-4 pt-4 pb-2 text-left font-mono text-[11px] font-medium tracking-[0.12em] text-text-tertiary uppercase">
                            {isSlashMode
                              ? t(($) => $['gotoAnything.groups.commands'], { ns: 'app' })
                              : t(($) => $['gotoAnything.selectSearchType'], { ns: 'app' })}
                          </AutocompleteGroupLabel>
                          <div className="px-4 pb-4" role="presentation">
                            {commandRows.map((row) => (
                              <AutocompleteRow
                                key={row.map((option) => option.shortcut).join(':')}
                                className="grid grid-cols-2 gap-2"
                              >
                                {row.map((option) => (
                                  <AutocompleteItem
                                    key={option.shortcut}
                                    value={option}
                                    className="group m-0 min-h-18 items-start gap-3 rounded-xl border-[0.5px] border-components-card-border bg-components-card-bg/90 p-3 shadow-xs shadow-shadow-shadow-3 backdrop-blur-sm hover:border-divider-regular hover:bg-state-base-hover-alt data-highlighted:border-state-accent-solid data-highlighted:bg-state-base-hover"
                                    onClick={() => selectOption(option)}
                                  >
                                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border-[0.5px] border-divider-regular bg-background-default text-text-tertiary group-data-highlighted:text-text-accent">
                                      <span aria-hidden className={`${option.icon} size-4`} />
                                    </span>
                                    <span className="min-w-0 flex-1 text-left">
                                      <span className="block truncate font-mono text-xs font-semibold tracking-[-0.01em] text-text-primary">
                                        {option.shortcut}
                                      </span>
                                      <span className="mt-1 line-clamp-2 block text-xs leading-4 text-text-tertiary">
                                        {getCommandOptionDescription(option)}
                                      </span>
                                    </span>
                                  </AutocompleteItem>
                                ))}
                              </AutocompleteRow>
                            ))}
                          </div>
                        </AutocompleteGroup>
                      )}

                      {!isError &&
                        !isCommandsMode &&
                        !emptyStateVariant &&
                        autocompleteResultCount > 0 &&
                        Object.entries(groupedResults).map(([type, results]) => (
                          <AutocompleteGroup key={type} items={results}>
                            <AutocompleteGroupLabel className="px-4 pt-3 pb-2 text-text-secondary capitalize">
                              {getGroupLabel(type)}
                            </AutocompleteGroupLabel>
                            <AutocompleteCollection<SearchResult>>
                              {(result) => (
                                <AutocompleteItem
                                  key={`${result.type}-${result.id}`}
                                  value={result}
                                  className="mx-2 gap-3 p-3"
                                  onClick={() => selectOption(result)}
                                >
                                  {result.icon}
                                  <div className="min-w-0 flex-1">
                                    <div className="truncate font-medium text-text-secondary">
                                      {result.title}
                                    </div>
                                    {result.description && (
                                      <div className="mt-0.5 truncate text-xs text-text-quaternary">
                                        {result.description}
                                      </div>
                                    )}
                                  </div>
                                  <div className="text-xs text-text-quaternary capitalize">
                                    {result.type}
                                  </div>
                                </AutocompleteItem>
                              )}
                            </AutocompleteCollection>
                          </AutocompleteGroup>
                        ))}
                    </AutocompleteList>
                  </ScrollAreaContent>
                </ScrollAreaViewport>
                <ScrollAreaScrollbar>
                  <ScrollAreaThumb />
                </ScrollAreaScrollbar>
              </ScrollArea>

              <Footer
                resultCount={trimmedSearchQuery ? autocompleteResultCount : null}
                canActivate={autocompleteResultCount > 0}
                hasPartialFailure={hasUnavailableServices && !isError}
              />
            </Autocomplete>
            <DialogClose className="sr-only">
              {t(($) => $['operation.close'], { ns: 'common' })}
            </DialogClose>
          </DialogPopup>
        </DialogPortal>
      </Dialog>

      {activePlugin && canInstallPlugin && (
        <PluginInstallPermissionProvider
          canInstallPlugin={canInstallPlugin}
          currentDifyVersion={currentDifyVersion}
        >
          <InstallFromMarketplace
            manifest={activePlugin}
            uniqueIdentifier={activePlugin.latest_package_identifier}
            onClose={() => setActivePlugin(undefined)}
            onSuccess={() => setActivePlugin(undefined)}
          />
        </PluginInstallPermissionProvider>
      )}
    </>
  )
}

export function GotoAnything() {
  return <GotoAnythingDialog />
}
