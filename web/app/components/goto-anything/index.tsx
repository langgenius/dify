'use client'

import type { AutocompleteChangeEventDetails } from '@langgenius/dify-ui/autocomplete'
import type { Plugin } from '../plugins/types'
import type { ActionItem, RecentSearchResult, SearchResult } from './actions/types'
import {
  Autocomplete,
  AutocompleteCollection,
  AutocompleteGroup,
  AutocompleteGroupLabel,
  AutocompleteInput,
  AutocompleteInputGroup,
  AutocompleteItem,
  AutocompleteList,
  AutocompleteStatus,
} from '@langgenius/dify-ui/autocomplete'
import {
  Dialog,
  DialogBackdrop,
  DialogCloseButton,
  DialogPopup,
  DialogPortal,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Kbd, KbdGroup } from '@langgenius/dify-ui/kbd'
import {
  ScrollAreaContent,
  ScrollAreaRoot,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '@langgenius/dify-ui/scroll-area'
import { formatForDisplay, useHotkey } from '@tanstack/react-hotkeys'
import { useQuery } from '@tanstack/react-query'
import { useDebounce } from 'ahooks'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { selectWorkflowNode } from '@/app/components/workflow/utils/node-navigation'
import { useGetLanguage } from '@/context/i18n'
import { usePathname, useRouter } from '@/next/navigation'
import { PluginInstallPermissionProvider } from '../plugins/install-plugin/components/plugin-install-permission-provider'
import useWorkspacePluginInstallPermission from '../plugins/install-plugin/hooks/use-workspace-plugin-install-permission'
import InstallFromMarketplace from '../plugins/install-plugin/install-from-marketplace'
import { createActions, getActionSearchTerm, matchAction } from './actions'
import { appSearchQueryOptions } from './actions/app'
import { slashCommandRegistry } from './actions/commands/registry'
import { SlashCommandProvider } from './actions/commands/slash-provider'
import { knowledgeSearchQueryOptions } from './actions/knowledge'
import { pluginSearchQueryOptions } from './actions/plugin'
import { addRecentItem, getRecentItems } from './actions/recent-store'
import { EmptyState } from './components/empty-state'
import { Footer } from './components/footer'
import { gotoAnythingDialogHandle } from './dialog-handle'

const appWorkflowPathPattern = /^\/app\/[^/]+\/workflow$/
const sharedWorkflowPathPattern = /^\/workflow\/[^/]+$/
const ragPipelinePathPattern = /^\/datasets\/[^/]+\/pipeline$/
const searchHotkey = 'Mod+K'
const searchShortcut = searchHotkey.split('+')

type CommandOption = {
  kind: 'command-option'
  shortcut: string
  description: string
}

type GotoAnythingOption = CommandOption | SearchResult

const slashCommandDescriptionKeys = {
  '/create': 'gotoAnything.actions.createCategoryDesc',
  '/refine': 'gotoAnything.actions.refineCategoryDesc',
  '/theme': 'gotoAnything.actions.themeCategoryDesc',
  '/language': 'gotoAnything.actions.languageChangeDesc',
  '/account': 'gotoAnything.actions.accountDesc',
  '/feedback': 'gotoAnything.actions.feedbackDesc',
  '/docs': 'gotoAnything.actions.docDesc',
  '/community': 'gotoAnything.actions.communityDesc',
} as const

const actionDescriptionKeys = {
  '@app': 'gotoAnything.actions.searchApplicationsDesc',
  '@plugin': 'gotoAnything.actions.searchPluginsDesc',
  '@knowledge': 'gotoAnything.actions.searchKnowledgeBasesDesc',
  '@node': 'gotoAnything.actions.searchWorkflowNodesDesc',
} as const

const groupLabelKeys = {
  app: 'gotoAnything.groups.apps',
  plugin: 'gotoAnything.groups.plugins',
  knowledge: 'gotoAnything.groups.knowledgeBases',
  'workflow-node': 'gotoAnything.groups.workflowNodes',
  command: 'gotoAnything.groups.commands',
  recent: 'gotoAnything.groups.recent',
} as const

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
      }))
  }

  return Object.values(actions)
    .filter((action) => action.key !== '/')
    .filter((action) => !filter || action.shortcut.toLowerCase().includes(filter))
    .map((action) => ({
      kind: 'command-option',
      shortcut: action.shortcut,
      description: action.description,
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

function getSearchModeLabel(searchMode: string) {
  if (searchMode === 'scopes') return 'SCOPES'
  if (searchMode === 'commands') return 'COMMANDS'
  return searchMode.replace('@', '').toUpperCase()
}

function getSearchMode(
  searchQuery: string,
  isCommandsMode: boolean,
  actions: Record<string, ActionItem>,
) {
  if (isCommandsMode) return searchQuery.trim().startsWith('@') ? 'scopes' : 'commands'

  const action = matchAction(searchQuery.trim().toLowerCase(), actions)
  if (!action) return 'general'

  return action.key === '/' ? '@command' : action.key
}

function isCommandSelectionQuery(query: string, actions: Record<string, ActionItem>) {
  const trimmedQuery = query.trim()
  if (trimmedQuery === '@' || trimmedQuery === '/') return true

  return (
    (trimmedQuery.startsWith('@') || trimmedQuery.startsWith('/')) &&
    !matchAction(trimmedQuery, actions)
  )
}

function getRecentSearchResults(): RecentSearchResult[] {
  return getRecentItems().map((item) => ({
    id: `recent-${item.id}`,
    title: item.title,
    description: item.description,
    type: 'recent',
    originalType: item.originalType,
    path: item.path,
    icon: (
      <div className="flex h-6 w-6 items-center justify-center rounded-md border-[0.5px] border-divider-regular bg-components-panel-bg">
        <span aria-hidden className="i-ri-time-line size-4 text-text-tertiary" />
      </div>
    ),
    data: { path: item.path },
  }))
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

function GotoAnythingDialog() {
  const { t } = useTranslation()
  const pathname = usePathname()
  const router = useRouter()
  const defaultLocale = useGetLanguage()
  const isWorkflowPage =
    appWorkflowPathPattern.test(pathname) || sharedWorkflowPathPattern.test(pathname)
  const isRagPipelinePage = ragPipelinePathPattern.test(pathname)
  const { canInstallPlugin, currentDifyVersion } = useWorkspacePluginInstallPermission()
  const [searchQuery, setSearchQuery] = useState('')
  const [activePlugin, setActivePlugin] = useState<Plugin>()
  const inputRef = useRef<HTMLInputElement>(null)
  const actions = useMemo(
    () => createActions(isWorkflowPage, isRagPipelinePage),
    [isWorkflowPage, isRagPipelinePage],
  )
  const trimmedSearchQuery = searchQuery.trim()
  const isCommandsMode = isCommandSelectionQuery(searchQuery, actions)
  const searchMode = getSearchMode(searchQuery, isCommandsMode, actions)
  const debouncedSearchQuery = useDebounce(searchQuery, { wait: 300 })
  const normalizedDebouncedQuery = debouncedSearchQuery.trim().toLowerCase()
  const isDebouncedCommandsMode = isCommandSelectionQuery(debouncedSearchQuery, actions)
  const debouncedAction = matchAction(normalizedDebouncedQuery, actions)
  const debouncedSearchTerm = debouncedAction
    ? getActionSearchTerm(normalizedDebouncedQuery, debouncedAction)
    : normalizedDebouncedQuery
  const remoteSearchEnabled = Boolean(normalizedDebouncedQuery) && !isDebouncedCommandsMode
  const appSearchEnabled =
    remoteSearchEnabled && (!debouncedAction || debouncedAction.key === '@app')
  const knowledgeSearchEnabled =
    remoteSearchEnabled && (!debouncedAction || debouncedAction.key === '@knowledge')
  const pluginSearchEnabled =
    remoteSearchEnabled && (!debouncedAction || debouncedAction.key === '@plugin')
  const appSearchQuery = useQuery({
    ...appSearchQueryOptions(debouncedSearchTerm, debouncedAction?.key === '@app'),
    enabled: appSearchEnabled,
  })
  const knowledgeSearchQuery = useQuery({
    ...knowledgeSearchQueryOptions(debouncedSearchTerm),
    enabled: knowledgeSearchEnabled,
  })
  const pluginSearchQuery = useQuery({
    ...pluginSearchQueryOptions(debouncedSearchTerm, defaultLocale),
    enabled: pluginSearchEnabled,
  })
  const localSearchResults = useMemo(() => {
    if (!trimmedSearchQuery || isCommandsMode) return []

    const normalizedQuery = trimmedSearchQuery.toLowerCase()
    const action = matchAction(normalizedQuery, actions)
    if (action?.source === 'local') {
      return action.search(
        normalizedQuery,
        getActionSearchTerm(normalizedQuery, action),
        defaultLocale,
      )
    }
    if (action) return []

    return Object.values(actions).flatMap((candidate) => {
      if (candidate.source !== 'local' || candidate.key === '/') return []
      return candidate.search(normalizedQuery, normalizedQuery, defaultLocale)
    })
  }, [actions, defaultLocale, isCommandsMode, trimmedSearchQuery])
  const activeRemoteQueries = [
    appSearchEnabled ? appSearchQuery : undefined,
    knowledgeSearchEnabled ? knowledgeSearchQuery : undefined,
    pluginSearchEnabled ? pluginSearchQuery : undefined,
  ].filter((query) => query !== undefined)
  const isDebouncing = remoteSearchEnabled && searchQuery.trim() !== debouncedSearchQuery.trim()
  const isLoading = isDebouncing || activeRemoteQueries.some((query) => query.isLoading)
  const failedRemoteQueries = activeRemoteQueries.filter((query) => query.isError)
  const isError =
    activeRemoteQueries.length > 0 && failedRemoteQueries.length === activeRemoteQueries.length
  const hasUnavailableServices = failedRemoteQueries.length > 0
  const queryError = failedRemoteQueries[0]?.error
  const error = queryError instanceof Error ? queryError : null
  const remoteSearchResults = isDebouncing
    ? []
    : activeRemoteQueries.flatMap((query) => query.data ?? [])
  const searchResults = [...localSearchResults, ...remoteSearchResults]
  const recentResults = trimmedSearchQuery || isCommandsMode ? [] : getRecentSearchResults()
  const dedupedResults = dedupeSearchResults(recentResults.length ? recentResults : searchResults)
  const groupedResults = groupSearchResults(dedupedResults)

  function resetSearch() {
    setSearchQuery('')
  }

  useHotkey(
    searchHotkey,
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
      case 'recent':
        if (result.path) router.push(result.path)
        break
      default:
        if ((result.type === 'app' || result.type === 'knowledge') && result.path) {
          addRecentItem({
            id: result.id,
            title: result.title,
            description: result.description,
            path: result.path,
            originalType: result.type,
          })
        }
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

  const commandOptions = getCommandOptions(actions, searchQuery)
  const autocompleteOptions: GotoAnythingOption[] = isCommandsMode ? commandOptions : dedupedResults
  const visibleOptions = isLoading || isError ? [] : autocompleteOptions
  const autocompleteResultCount = visibleOptions.length
  const isSlashMode = searchQuery.trim().startsWith('/')

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

  let emptyStateVariant: 'loading' | 'error' | 'default' | 'no-results' | null = null
  if (isLoading) emptyStateVariant = 'loading'
  else if (isError) emptyStateVariant = 'error'
  else if (!trimmedSearchQuery && autocompleteResultCount === 0) emptyStateVariant = 'default'
  else if (autocompleteResultCount === 0 && !isCommandsMode) emptyStateVariant = 'no-results'

  return (
    <>
      <SlashCommandProvider />
      <Dialog handle={gotoAnythingDialogHandle} onOpenChange={resetSearch}>
        <DialogPortal>
          <DialogBackdrop />
          <DialogPopup
            initialFocus={inputRef}
            className="fixed top-1/2 left-1/2 max-h-[80dvh] w-[480px]! max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-hidden p-0!"
          >
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
                  {searchMode !== 'general' && (
                    <div className="flex items-center gap-1 rounded-sm bg-gray-100 px-2 py-[2px] text-xs font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                      <span>{getSearchModeLabel(searchMode)}</span>
                    </div>
                  )}
                </div>
                <KbdGroup>
                  {searchShortcut.map((key) => (
                    <Kbd key={key}>{formatForDisplay(key)}</Kbd>
                  ))}
                </KbdGroup>
              </AutocompleteInputGroup>

              <AutocompleteStatus className="sr-only">{autocompleteStatus}</AutocompleteStatus>

              <ScrollAreaRoot
                aria-busy={isLoading || undefined}
                className="relative h-[240px] min-h-0 overflow-hidden"
              >
                <ScrollAreaViewport className="scroll-py-1 overscroll-contain">
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

                    {!isLoading && !isError && isCommandsMode && autocompleteResultCount > 0 && (
                      <AutocompleteList className="max-h-none overflow-visible p-0">
                        <AutocompleteGroup items={commandOptions}>
                          <AutocompleteGroupLabel className="px-4 pt-3 pb-2 text-left text-sm font-medium text-text-secondary">
                            {isSlashMode
                              ? t(($) => $['gotoAnything.groups.commands'], { ns: 'app' })
                              : t(($) => $['gotoAnything.selectSearchType'], { ns: 'app' })}
                          </AutocompleteGroupLabel>
                          <AutocompleteCollection>
                            {(option: CommandOption) => (
                              <AutocompleteItem
                                key={option.shortcut}
                                value={option}
                                className="mx-4 p-2"
                                onClick={() => selectOption(option)}
                              >
                                <span className="min-w-18 text-left font-mono text-xs text-text-tertiary">
                                  {option.shortcut}
                                </span>
                                <span className="ml-3 text-sm text-text-secondary">
                                  {isSlashMode
                                    ? t(
                                        ($) =>
                                          $[
                                            slashCommandDescriptionKeys[
                                              option.shortcut as keyof typeof slashCommandDescriptionKeys
                                            ] || option.description
                                          ],
                                        { ns: 'app' },
                                      )
                                    : t(
                                        ($) =>
                                          $[
                                            actionDescriptionKeys[
                                              option.shortcut as keyof typeof actionDescriptionKeys
                                            ]
                                          ],
                                        { ns: 'app' },
                                      )}
                                </span>
                              </AutocompleteItem>
                            )}
                          </AutocompleteCollection>
                        </AutocompleteGroup>
                      </AutocompleteList>
                    )}

                    {!isLoading && !isError && !isCommandsMode && emptyStateVariant && (
                      <EmptyState
                        variant={emptyStateVariant}
                        searchMode={searchMode}
                        actions={actions}
                      />
                    )}

                    {!isLoading &&
                      !isError &&
                      !isCommandsMode &&
                      !emptyStateVariant &&
                      autocompleteResultCount > 0 && (
                        <AutocompleteList className="max-h-none overflow-visible p-0">
                          {Object.entries(groupedResults).map(([type, results]) => (
                            <AutocompleteGroup key={type} items={results}>
                              <AutocompleteGroupLabel className="px-4 pt-3 pb-2 text-text-secondary capitalize">
                                {t(
                                  ($) =>
                                    $[
                                      groupLabelKeys[type as keyof typeof groupLabelKeys] ||
                                        `${type}s`
                                    ],
                                  { ns: 'app' },
                                )}
                              </AutocompleteGroupLabel>
                              <AutocompleteCollection>
                                {(result: SearchResult) => (
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
                      )}
                  </ScrollAreaContent>
                </ScrollAreaViewport>
                <ScrollAreaScrollbar>
                  <ScrollAreaThumb />
                </ScrollAreaScrollbar>
              </ScrollAreaRoot>

              <Footer
                resultCount={autocompleteResultCount}
                searchMode={searchMode}
                isLoading={isLoading}
                hasUnavailableServices={hasUnavailableServices}
                isCommandsMode={isCommandsMode}
                hasQuery={!!searchQuery.trim()}
              />
            </Autocomplete>
            <DialogCloseButton
              className="sr-only"
              aria-label={t(($) => $['operation.close'], { ns: 'common' })}
            />
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
