'use client'

import type { AutocompleteChangeEventDetails } from '@langgenius/dify-ui/autocomplete'
import type { Plugin } from '../plugins/types'
import type { ActionItem, SearchResult } from './actions/types'
import type { GotoAnythingOption } from './command-options'
import {
  Autocomplete,
  AutocompleteInput,
  AutocompleteInputGroup,
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
import { useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { selectWorkflowNode } from '@/app/components/workflow/utils/node-navigation'
import { useGetLanguage } from '@/context/i18n'
import { isCurrentWorkspaceDatasetOperatorAtom } from '@/context/workspace-state'
import { isAgentV2Enabled } from '@/features/agent-v2/feature-flag'
import { usePathname, useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/console'
import { PluginInstallPermissionProvider } from '../plugins/install-plugin/components/plugin-install-permission-provider'
import useWorkspacePluginInstallPermission from '../plugins/install-plugin/hooks/use-workspace-plugin-install-permission'
import InstallFromMarketplace from '../plugins/install-plugin/install-from-marketplace'
import { createActions, getActionSearchTerm, matchAction } from './actions'
import { agentSearchQueryOptions } from './actions/agent'
import { appSearchQueryOptions } from './actions/app'
import { slashCommandRegistry } from './actions/commands/catalog'
import { createSlashAction } from './actions/commands/slash'
import { useCommandContext } from './actions/commands/use-command-context'
import { knowledgeSearchQueryOptions } from './actions/knowledge'
import { pluginSearchQueryOptions } from './actions/plugin'
import { skillSearchQueryOptions } from './actions/skill'
import { isCommandOption, useCommandOptions } from './command-options'
import { EmptyState } from './components/empty-state'
import { Footer } from './components/footer'
import { gotoAnythingDialogHandle } from './dialog-handle'
import { GOTO_ANYTHING_HOTKEY } from './hotkeys'
import { CommandGrid, ResultList } from './results'

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

export function GotoAnything() {
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
  const isWorkflowPage =
    appWorkflowPathPattern.test(pathname) || sharedWorkflowPathPattern.test(pathname)
  const isRagPipelinePage = ragPipelinePathPattern.test(pathname)
  const { canInstallPlugin, currentDifyVersion } = useWorkspacePluginInstallPermission()
  const [searchQuery, setSearchQuery] = useState('')
  const [activePlugin, setActivePlugin] = useState<Plugin>()
  const inputRef = useRef<HTMLInputElement>(null)
  const searchHintId = useId()
  const commandContext = useCommandContext(agentsAvailable, skillsAvailable, isWorkflowPage)
  const actions = useMemo(
    () =>
      createActions(createSlashAction(commandContext), isWorkflowPage, isRagPipelinePage, {
        agents: agentsAvailable,
        skills: skillsAvailable,
      }),
    [agentsAvailable, commandContext, isWorkflowPage, isRagPipelinePage, skillsAvailable],
  )
  const { commandOptions, scopeOptions } = useCommandOptions(actions, searchQuery, commandContext)
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
  const appSearchQuery = useQuery(
    appSearchQueryOptions(debouncedSearchTerm, debouncedAction?.key === '@app', {
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
  const pluginSearchQuery = useQuery(
    pluginSearchQueryOptions(debouncedSearchTerm, defaultLocale, {
      enabled: pluginSearchEnabled,
      placeholderData: keepPreviousData,
    }),
  )
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
  const remoteSearchResults = currentRemoteQueries.flatMap((query) => query.data ?? [])
  const searchResults = [...localSearchResults, ...remoteSearchResults]
  const dedupedResults = dedupeSearchResults(searchResults)
  const groupedResults = groupSearchResults(dedupedResults)

  function handleDialogOpenChangeComplete(open: boolean) {
    if (!open) setSearchQuery('')
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
      if (handler?.isAvailable?.(commandContext) === false) return
      if (handler?.mode === 'direct') {
        void slashCommandRegistry.execute(handler.name, {}, commandContext)
        gotoAnythingDialogHandle.close()
        return
      }
    }

    changeSearchQuery(commandKey === '/' ? '/' : `${commandKey} `)
  }

  function changeSearchQuery(query: string) {
    setSearchQuery(query)
    // Autocomplete finishes activating the old option before focus returns to the input.
    queueMicrotask(() => inputRef.current?.focus())
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

  function handleAutocompleteValueChange(
    nextValue: string,
    eventDetails: AutocompleteChangeEventDetails,
  ) {
    if (eventDetails.reason !== 'item-press') setSearchQuery(nextValue)
  }

  function selectOption(option: GotoAnythingOption) {
    if (!isCommandOption(option)) handleNavigate(option)
    else if (option.result) handleNavigate(option.result)
    else handleCommandSelect(option.shortcut)
  }

  function getGroupLabel(type: string) {
    if (type === 'skill') return t(($) => $['skillManagement.title'], { ns: 'skill' })
    if (type === 'agent') return t(($) => $['roster.title'], { ns: 'agentRoster' })

    return t(($) => $[groupLabelKeys[type as keyof typeof groupLabelKeys] || `${type}s`], {
      ns: 'app',
    })
  }

  const isHome = !trimmedSearchQuery
  const isScopeSelection = isCommandsMode && trimmedSearchQuery.startsWith('@')
  const showCommands =
    isHome || (isCommandsMode && !isScopeSelection) || (!currentAction && !isCommandsMode)
  const optionSuggestions = isScopeSelection ? scopeOptions : showCommands ? commandOptions : []
  const visibleOptions: GotoAnythingOption[] = [
    ...optionSuggestions,
    ...(isHome ? scopeOptions : []),
    ...(!isCommandsMode ? dedupedResults : []),
  ]
  const optionGroups = [
    {
      id: isScopeSelection ? 'scopes' : 'commands',
      label: isScopeSelection
        ? t(($) => $['gotoAnything.selectSearchType'], { ns: 'app' })
        : t(($) => $['gotoAnything.groups.commands'], { ns: 'app' }),
      items: optionSuggestions,
    },
    ...(isHome
      ? [
          {
            id: 'scopes',
            label: t(($) => $['gotoAnything.selectSearchType'], { ns: 'app' }),
            items: scopeOptions,
          },
        ]
      : []),
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

  let emptyStateVariant: 'loading' | 'error' | 'no-results' | null = null
  if (isLoading && autocompleteResultCount === 0) emptyStateVariant = 'loading'
  else if (isError) emptyStateVariant = 'error'
  else if (autocompleteResultCount === 0) emptyStateVariant = 'no-results'

  return (
    <>
      <Dialog
        handle={gotoAnythingDialogHandle}
        onOpenChangeComplete={handleDialogOpenChangeComplete}
      >
        <DialogPortal>
          <DialogBackdrop />
          <DialogPopup
            initialFocus={inputRef}
            className="fixed top-1/2 left-1/2 isolate flex max-h-[calc(100dvh-2rem)] w-160 max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden p-0"
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
                className="h-auto shrink-0 gap-3 rounded-none border-0 bg-components-panel-bg-blur px-4 py-3 has-[input:focus]:ring-0"
              >
                <span aria-hidden className="i-ri-search-line size-4 text-text-quaternary" />
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <AutocompleteInput
                    ref={inputRef}
                    size="medium"
                    aria-label={t(($) => $['gotoAnything.searchTitle'], { ns: 'app' })}
                    placeholder={t(($) => $['gotoAnything.searchPlaceholder'], { ns: 'app' })}
                    aria-describedby={searchHintId}
                    className="px-0"
                  />
                </div>
                <KbdGroup className="hidden sm:flex">
                  {formatForDisplay(GOTO_ANYTHING_HOTKEY, { parts: true }).map((key) => (
                    <Kbd key={key}>{key}</Kbd>
                  ))}
                </KbdGroup>
              </AutocompleteInputGroup>
              <p id={searchHintId} className="sr-only">
                {t(($) => $['gotoAnything.searchHint'], { ns: 'app' })}
              </p>

              <AutocompleteStatus className="sr-only">{autocompleteStatus}</AutocompleteStatus>

              <ScrollArea className="h-120 min-h-0 shrink overflow-hidden border-t border-divider-subtle">
                <ScrollAreaViewport
                  tabIndex={-1}
                  aria-busy={isLoading || undefined}
                  className="scroll-pt-10 scroll-pb-1 overscroll-contain"
                >
                  <ScrollAreaContent
                    className="min-h-full w-full max-w-full"
                    style={{ minWidth: '100%' }}
                  >
                    {emptyStateVariant === 'loading' && <EmptyState variant="loading" />}

                    {emptyStateVariant === 'error' && <EmptyState variant="error" error={error} />}

                    {emptyStateVariant === 'no-results' && isCommandsMode && (
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

                    {emptyStateVariant === 'no-results' && !isCommandsMode && (
                      <EmptyState
                        variant={emptyStateVariant}
                        searchMode={searchMode}
                        actions={actions}
                      />
                    )}

                    {isCommandsMode ? (
                      <CommandGrid
                        groups={optionGroups}
                        label={
                          isHome
                            ? t(($) => $['gotoAnything.searchTitle'], { ns: 'app' })
                            : optionGroups[0]!.label
                        }
                        onSelect={selectOption}
                      />
                    ) : (
                      <ResultList
                        groups={[
                          {
                            id: 'commands',
                            label: getGroupLabel('command'),
                            items: optionSuggestions,
                          },
                          ...Object.entries(groupedResults).map(([type, items]) => ({
                            id: type,
                            label: getGroupLabel(type),
                            items,
                          })),
                        ]}
                        label={t(($) => $['gotoAnything.searchTitle'], { ns: 'app' })}
                        onSelect={selectOption}
                      />
                    )}
                  </ScrollAreaContent>
                </ScrollAreaViewport>
                <ScrollAreaScrollbar>
                  <ScrollAreaThumb />
                </ScrollAreaScrollbar>
              </ScrollArea>

              <Footer
                onSelectMode={changeSearchQuery}
                resultCount={trimmedSearchQuery ? autocompleteResultCount : null}
                isLoading={isLoading}
                hasPartialFailure={hasUnavailableServices && !isError}
              />
            </Autocomplete>
            <DialogClose tabIndex={-1} className="sr-only">
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
