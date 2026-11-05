'use client'

import type { AutocompleteChangeEventDetails } from '@langgenius/dify-ui/autocomplete'
import type { KeyboardEvent, ReactNode, RefObject } from 'react'
import type { Plugin } from '../plugins/types'
import type { ActionItem, SearchResult } from './actions/types'
import type { GotoAnythingOption, ScopeSelection, SearchScope } from './command-options'
import type { EmptyStateProps } from './components/empty-state'
import {
  Autocomplete,
  AutocompleteClear,
  AutocompleteInput,
  AutocompleteInputGroup,
} from '@langgenius/dify-ui/autocomplete'
import { cn } from '@langgenius/dify-ui/cn'
import { DrawerContent } from '@langgenius/dify-ui/drawer'
import {
  ScrollArea,
  ScrollAreaContent,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '@langgenius/dify-ui/scroll-area'
import { HotkeysProvider, useHotkey } from '@tanstack/react-hotkeys'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useDebouncedValue } from 'foxact/use-debounced-value'
import { useAtomValue } from 'jotai'
import { useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { selectWorkflowNode } from '@/app/components/workflow/utils/node-navigation'
import { useGetLanguage } from '@/context/i18n'
import { isCurrentWorkspaceDatasetOperatorAtom } from '@/context/workspace-state'
import { isAgentV2Enabled } from '@/features/agent-v2/feature-flag'
import { useMarketplace, useMarketplacePluginSearch } from '@/features/marketplace/client'
import { usePathname, useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/console'
import { createActions, getActionSearchTerm, matchAction } from './actions'
import { agentSearchQueryOptions } from './actions/agent'
import { appSearchQueryOptions } from './actions/app'
import { slashCommandRegistry } from './actions/commands/catalog'
import { createSlashAction } from './actions/commands/slash'
import { useCommandContext } from './actions/commands/use-command-context'
import { knowledgeSearchQueryOptions } from './actions/knowledge'
import { parsePluginSearchResults } from './actions/plugin'
import { skillSearchQueryOptions } from './actions/skill'
import { isCommandOption, useCommandOptions } from './command-options'
import { ContextToken } from './components/context-token'
import { ScopeBar } from './components/scope-bar'
import { SearchAnnouncements } from './components/search-announcements'
import { SearchResults } from './components/search-results'
import { GOTO_ANYTHING_HOTKEY } from './hotkeys'

type Surface = 'dialog' | 'drawer'

const appWorkflowPathPattern = /^\/app\/[^/]+\/workflow$/
const sharedWorkflowPathPattern = /^\/workflow\/[^/]+$/
const ragPipelinePathPattern = /^\/datasets\/[^/]+\/pipeline$/

const groupLabelKeys = {
  app: 'gotoAnything.groups.apps',
  plugin: 'gotoAnything.groups.plugins',
  knowledge: 'gotoAnything.groups.knowledgeBases',
  'workflow-node': 'gotoAnything.groups.workflowNodes',
  command: 'gotoAnything.groups.commands',
} as const

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

function SearchDialogHotkeys() {
  // Keep the browser from claiming Mod+K while the global opener is suspended.
  useHotkey(GOTO_ANYTHING_HOTKEY, () => {})
  return null
}

function ResultsViewport({
  surface,
  isLoading,
  children,
}: {
  surface: Surface
  isLoading: boolean
  children: ReactNode
}) {
  const scrollArea = (
    <ScrollArea
      className={cn(
        'min-h-0 overflow-hidden',
        surface === 'dialog' ? 'h-120 shrink border-t border-divider-subtle' : 'flex-1',
      )}
    >
      <ScrollAreaViewport
        tabIndex={-1}
        aria-busy={isLoading || undefined}
        className={cn(
          'scroll-pt-10 overscroll-contain',
          surface === 'dialog'
            ? 'scroll-pb-2'
            : 'scroll-pb-[calc(--spacing(2)+var(--drawer-keyboard-inset,0px))]',
        )}
      >
        <ScrollAreaContent
          className={cn(
            'min-h-full w-full max-w-full',
            surface === 'dialog'
              ? 'pb-2'
              : 'pb-[calc(--spacing(2)+env(safe-area-inset-bottom)+var(--drawer-keyboard-inset,0px))]',
          )}
          style={{ minWidth: '100%' }}
        >
          {children}
        </ScrollAreaContent>
      </ScrollAreaViewport>
      <ScrollAreaScrollbar>
        <ScrollAreaThumb />
      </ScrollAreaScrollbar>
    </ScrollArea>
  )

  if (surface === 'dialog') return scrollArea

  return (
    <DrawerContent className="overflow-hidden border-t border-divider-subtle">
      {scrollArea}
    </DrawerContent>
  )
}

type SearchSessionProps = {
  surface: Surface
  inputRef: RefObject<HTMLInputElement | null>
  onClose: () => void
  onInstallPlugin: (plugin: Plugin) => void
}

export function SearchSession({ surface, inputRef, onClose, onInstallPlugin }: SearchSessionProps) {
  const { t } = useTranslation(['app', 'common', 'skill', 'modelProvider', 'agentRoster'])
  const pathname = usePathname()
  const router = useRouter()
  const defaultLocale = useGetLanguage()
  const isCurrentWorkspaceDatasetOperator = useAtomValue(isCurrentWorkspaceDatasetOperatorAtom)
  const { data: enableSkill } = useQuery(
    consoleQuery.features.get.queryOptions({
      select: (features) => features.enable_skill,
    }),
  )
  const agentsAvailable = isAgentV2Enabled()
  const skillsAvailable = enableSkill === true && !isCurrentWorkspaceDatasetOperator
  const pluginsAvailable = useMarketplace() !== null
  const isWorkflowPage =
    appWorkflowPathPattern.test(pathname) || sharedWorkflowPathPattern.test(pathname)
  const isRagPipelinePage = ragPipelinePathPattern.test(pathname)
  const [term, setTerm] = useState('')
  const [scope, setScope] = useState<ScopeSelection>('all')
  const [page, setPage] = useState<string | null>(null)
  const searchHintId = useId()
  const hotkeyScopeId = useId()
  const commandContext = useCommandContext(agentsAvailable, skillsAvailable, isWorkflowPage)
  const actions = useMemo(
    () =>
      createActions(createSlashAction(commandContext), isWorkflowPage, isRagPipelinePage, {
        agents: agentsAvailable,
        plugins: pluginsAvailable,
        skills: skillsAvailable,
      }),
    [
      agentsAvailable,
      commandContext,
      isWorkflowPage,
      isRagPipelinePage,
      pluginsAvailable,
      skillsAvailable,
    ],
  )
  const scopeAction = Object.values(actions).find((action) => action.key === scope)
  const activeScope = scopeAction ? scope : 'all'
  const searchQuery = page ? `/${page} ${term}` : scopeAction ? `${scopeAction.key} ${term}` : term
  const { commandOptions, scopeOptions, allScopeOptions, allCommandOptions } = useCommandOptions(
    actions,
    searchQuery,
    commandContext,
  )
  const pageOption = page
    ? allCommandOptions.find((option) => option.shortcut === `/${page}`)
    : undefined
  const scopeOption = allScopeOptions.find((option) => option.scope === activeScope)
  const trimmedSearchQuery = searchQuery.trim()
  const normalizedSearchQuery = searchQuery.trimStart().toLowerCase()
  const isCommandsMode = isCommandSelectionQuery(searchQuery, actions)
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
    remoteSearchEnabled &&
    pluginsAvailable &&
    (!debouncedAction || debouncedAction.key === '@plugin')
  const skillSearchEnabled =
    remoteSearchEnabled && skillsAvailable && (!debouncedAction || debouncedAction.key === '@skill')
  const agentSearchEnabled =
    remoteSearchEnabled &&
    agentsAvailable &&
    (!debouncedAction || debouncedAction.key === '@agents')
  const appSearchQuery = useQuery(
    appSearchQueryOptions(debouncedSearchTerm, {
      enabled: appSearchEnabled,
      placeholderData: keepPreviousData,
    }),
  )
  const knowledgeSearchQuery = useQuery(
    knowledgeSearchQueryOptions(debouncedSearchTerm, {
      enabled: knowledgeSearchEnabled,
      placeholderData: keepPreviousData,
    }),
  )
  const pluginSearchQuery = useMarketplacePluginSearch(debouncedSearchTerm, {
    enabled: pluginSearchEnabled,
    select: (plugins) => parsePluginSearchResults(plugins, defaultLocale),
  })
  const skillSearchQuery = useQuery(
    skillSearchQueryOptions(debouncedSearchTerm, {
      enabled: skillSearchEnabled,
      placeholderData: keepPreviousData,
    }),
  )
  const agentSearchQuery = useQuery(
    agentSearchQueryOptions(debouncedSearchTerm, {
      enabled: agentSearchEnabled,
      placeholderData: keepPreviousData,
    }),
  )
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
  const localSearchEnabled = Boolean(trimmedSearchQuery) && !isCommandsMode
  const localSearchResults = useMemo(() => {
    if (!localSearchEnabled) return []

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
  }, [actions, defaultLocale, localSearchEnabled, localSearchQuery])
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
  const allRemoteSearchesFailed =
    currentRemoteQueries.length > 0 && failedRemoteQueries.length === currentRemoteQueries.length
  const hasUnavailableServices = failedRemoteQueries.length > 0
  const queryError = failedRemoteQueries[0]?.error
  const error = queryError instanceof Error ? queryError : null
  const remoteSearchResults = currentRemoteQueries.flatMap<SearchResult>(
    (query) => query.data ?? [],
  )
  const searchResults = [...localSearchResults, ...remoteSearchResults]
  const dedupedResults = dedupeSearchResults(searchResults)
  const groupedResults = groupSearchResults(dedupedResults)

  function focusInput() {
    queueMicrotask(() => inputRef.current?.focus())
  }

  function openPage(name: string, rest = '') {
    setPage(name)
    setScope('all')
    setTerm(rest)
    focusInput()
  }

  function closePage() {
    setPage(null)
    setTerm('')
    focusInput()
  }

  function selectScope(nextScope: SearchScope, rest = '') {
    setScope(nextScope)
    setTerm(rest)
    focusInput()
  }

  function clearScope() {
    setScope('all')
    focusInput()
  }

  function handleCommandSelect(shortcut: string) {
    const handler = slashCommandRegistry.findCommand(shortcut.slice(1))
    if (!handler || handler.isAvailable?.(commandContext) === false) return
    if (handler.mode === 'submenu') {
      openPage(handler.name)
      return
    }
    void slashCommandRegistry.execute(handler.name, {}, commandContext)
    onClose()
  }

  function handleKeyDownCapture(event: KeyboardEvent<HTMLElement>) {
    // oxlint-disable-next-line typescript/no-deprecated -- Safari reports IME composition through keyCode 229.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    if (event.target !== inputRef.current) return

    if (event.key === 'Escape' && surface === 'drawer' && term) {
      event.preventDefault()
      event.stopPropagation()
      setTerm('')
      return
    }

    if (event.key !== 'Backspace' || event.repeat || term) return
    if (page) {
      event.preventDefault()
      closePage()
    } else if (surface === 'dialog' && activeScope !== 'all') {
      event.preventDefault()
      clearScope()
    }
  }

  function changeTerm(nextTerm: string) {
    const prefix = page ? undefined : /^([@/][^\s@/]+)\s/.exec(nextTerm)
    if (prefix) {
      const token = prefix[1]!.toLowerCase()
      const rest = nextTerm.slice(prefix[0].length)
      const scopeMatch = allScopeOptions.find(
        (option) => option.shortcut === token || option.scope === token,
      )
      if (scopeMatch) {
        selectScope(scopeMatch.scope, rest)
        return
      }
      const command = token.startsWith('/')
        ? slashCommandRegistry.findCommand(token.slice(1))
        : undefined
      if (command?.mode === 'submenu' && command.isAvailable?.(commandContext) !== false) {
        openPage(command.name, rest)
        return
      }
    }
    setTerm(nextTerm)
  }

  function handleNavigate(result: SearchResult) {
    onClose()

    switch (result.type) {
      case 'command':
        actions.slash.action?.(result)
        break
      case 'plugin':
        onInstallPlugin(result.data)
        break
      case 'workflow-node':
        if (result.metadata?.nodeId) selectWorkflowNode(result.metadata.nodeId, true)
        break
      default:
        if (result.path) router.push(result.path)
    }
  }

  function handleAutocompleteValueChange(
    nextValue: string,
    eventDetails: AutocompleteChangeEventDetails,
  ) {
    if (eventDetails.reason !== 'item-press') changeTerm(nextValue)
  }

  function selectOption(option: GotoAnythingOption) {
    if (!isCommandOption(option)) handleNavigate(option)
    else if (option.result) handleNavigate(option.result)
    else if (option.scope) selectScope(option.scope)
    else handleCommandSelect(option.shortcut)
  }

  function getGroupLabel(type: string) {
    if (type === 'skill') return t(($) => $['skillManagement.title'], { ns: 'skill' })
    if (type === 'agent') return t(($) => $['roster.title'], { ns: 'agentRoster' })

    return t(($) => $[groupLabelKeys[type as keyof typeof groupLabelKeys] || `${type}s`], {
      ns: 'app',
    })
  }

  const isScopeSelection = isCommandsMode && trimmedSearchQuery.startsWith('@')
  const commandSuggestions = isCommandsMode || !currentAction ? commandOptions : []
  const showScopes =
    isScopeSelection ||
    (surface === 'dialog' && !currentAction && (!trimmedSearchQuery || !isCommandsMode))
  const scopeSuggestions = showScopes ? scopeOptions : []
  const visibleOptions: GotoAnythingOption[] = [
    ...commandSuggestions,
    ...scopeSuggestions,
    ...(!isCommandsMode ? dedupedResults : []),
  ]
  const resultGroups = [
    {
      id: 'commands',
      label: t(($) => $['gotoAnything.groups.commands'], { ns: 'app' }),
      items: commandSuggestions,
    },
    {
      id: 'scopes',
      label: t(($) => $['gotoAnything.selectSearchType'], { ns: 'app' }),
      items: scopeSuggestions,
    },
    ...(isCommandsMode
      ? []
      : Object.entries(groupedResults).map(([type, items]) => ({
          id: type,
          label: getGroupLabel(type),
          items,
        }))),
  ]
  const autocompleteResultCount = visibleOptions.length
  const isError = allRemoteSearchesFailed && autocompleteResultCount === 0

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

  let emptyState: EmptyStateProps['variant'] | null = null
  if (isLoading && autocompleteResultCount === 0) emptyState = 'loading'
  else if (isError) emptyState = 'error'
  else if (autocompleteResultCount === 0) emptyState = isCommandsMode ? 'no-commands' : 'no-results'

  const searchTitle = t(($) => $['gotoAnything.searchTitle'], { ns: 'app' })
  const tokenOption = pageOption ?? (surface === 'dialog' ? scopeOption : undefined)
  let placeholder: string = t(($) => $['gotoAnything.searchPlaceholder'], { ns: 'app' })
  if (pageOption) placeholder = t(($) => $['placeholder.search'], { ns: 'common' })
  else if (scopeOption)
    placeholder = t(($) => $['gotoAnything.searchInScopePlaceholder'], {
      ns: 'app',
      scope: scopeOption.title,
    })
  else if (surface === 'dialog')
    placeholder = t(($) => $['gotoAnything.searchOrFilterPlaceholder'], { ns: 'app' })

  return (
    <div className="flex min-h-0 flex-1 flex-col" onKeyDownCapture={handleKeyDownCapture}>
      <HotkeysProvider scope={hotkeyScopeId} exclusive>
        <SearchDialogHotkeys />
        <Autocomplete
          key={surface === 'dialog' ? (page ?? scope) : (page ?? 'home')}
          items={visibleOptions}
          value={term}
          onValueChange={handleAutocompleteValueChange}
          itemToStringValue={(option) => option.title}
          filter={null}
          open
          inline
          autoHighlight="always"
          keepHighlight
          loopFocus
        >
          <div className={cn('shrink-0', surface === 'drawer' && 'px-4 pt-2 pb-3')}>
            {surface === 'drawer' && (
              <div aria-hidden className="mx-auto mb-3 h-1 w-9 rounded-full bg-divider-deep" />
            )}
            <AutocompleteInputGroup
              size="medium"
              className={cn(
                // oxlint-disable-next-line shadcn/no-restyle -- The palette's search field is its header and keeps the ring off while the active descendant shows navigation.
                'has-[input:focus]:ring-0',
                surface === 'dialog'
                  ? 'h-auto gap-3 rounded-none border-0 bg-transparent px-4 py-3 hover:bg-transparent has-[input:focus]:bg-transparent'
                  : 'h-10 gap-2 rounded-[10px] px-3',
              )}
            >
              <span aria-hidden className="i-ri-search-line size-4 shrink-0 text-text-quaternary" />
              {tokenOption && (
                <ContextToken
                  title={tokenOption.title}
                  onRemove={pageOption ? closePage : clearScope}
                />
              )}
              <AutocompleteInput
                ref={inputRef}
                size="medium"
                aria-label={pageOption?.title ?? scopeOption?.title ?? searchTitle}
                aria-describedby={searchHintId}
                placeholder={placeholder}
                enterKeyHint={surface === 'drawer' ? 'go' : undefined}
                className={cn('px-0', surface === 'drawer' && 'text-base')}
              />
              {surface === 'drawer' && term && (
                <AutocompleteClear aria-label={t(($) => $['operation.clear'], { ns: 'common' })} />
              )}
            </AutocompleteInputGroup>
          </div>
          {surface === 'drawer' && !page && (
            <ScopeBar scopes={allScopeOptions} value={activeScope} onValueChange={setScope} />
          )}
          <SearchAnnouncements
            hintId={searchHintId}
            status={autocompleteStatus}
            describesTokenRemoval={Boolean(tokenOption)}
          />
          <ResultsViewport surface={surface} isLoading={isLoading}>
            <SearchResults
              groups={resultGroups}
              label={searchTitle}
              onSelect={selectOption}
              emptyState={emptyState}
              scope={activeScope}
              error={error}
              hasPartialFailure={hasUnavailableServices && !isError}
            />
          </ResultsViewport>
        </Autocomplete>
      </HotkeysProvider>
    </div>
  )
}
