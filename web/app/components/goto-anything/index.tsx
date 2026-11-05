'use client'

import type {
  AutocompleteChangeEventDetails,
  AutocompleteFlatProps,
  AutocompleteInputProps,
} from '@langgenius/dify-ui/autocomplete'
import type { ComponentProps, KeyboardEvent } from 'react'
import type { Plugin } from '../plugins/types'
import type { ActionItem, SearchResult } from './actions/types'
import type { GotoAnythingOption, ScopeSelection } from './command-options'
import {
  Autocomplete,
  AutocompleteClear,
  AutocompleteInput,
  AutocompleteInputGroup,
} from '@langgenius/dify-ui/autocomplete'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import {
  Drawer,
  DrawerBackdrop,
  DrawerClose,
  DrawerContent,
  DrawerPopup,
  DrawerPortal,
  DrawerTitle,
  DrawerViewport,
  DrawerVirtualKeyboardProvider,
} from '@langgenius/dify-ui/drawer'
import {
  ScrollArea,
  ScrollAreaContent,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '@langgenius/dify-ui/scroll-area'
import { useMediaQuery } from '@langgenius/dify-ui/use-media-query'
import { HotkeysProvider, useHotkey } from '@tanstack/react-hotkeys'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useDebouncedValue } from 'foxact/use-debounced-value'
import { useAtomValue } from 'jotai'
import { useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { selectWorkflowNode } from '@/app/components/workflow/utils/node-navigation'
import { useGetLanguage } from '@/context/i18n'
import { isCurrentWorkspaceDatasetOperatorAtom } from '@/context/workspace-state'
import { isAgentV2Enabled } from '@/features/agent-v2/feature-flag'
import { useMarketplace, useMarketplacePluginSearch } from '@/features/marketplace/client'
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
import { parsePluginSearchResults } from './actions/plugin'
import { skillSearchQueryOptions } from './actions/skill'
import { isCommandOption, useCommandOptions } from './command-options'
import { ContextToken } from './components/context-token'
import { ScopeBar } from './components/scope-bar'
import { SearchAnnouncements } from './components/search-announcements'
import { SearchResults } from './components/search-results'
import { gotoAnythingDialogHandle, gotoAnythingDrawerHandle } from './handles'
import { GOTO_ANYTHING_HOTKEY } from './hotkeys'

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

function isEditableShortcutTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false

  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
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

function SearchDialogHotkeys() {
  // Keep the browser from claiming Mod+K while the global opener is suspended.
  useHotkey(GOTO_ANYTHING_HOTKEY, () => {})
  return null
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
  const pluginsAvailable = useMarketplace() !== null
  const isWorkflowPage =
    appWorkflowPathPattern.test(pathname) || sharedWorkflowPathPattern.test(pathname)
  const isRagPipelinePage = ragPipelinePathPattern.test(pathname)
  const { canInstallPlugin, currentDifyVersion } = useWorkspacePluginInstallPermission()
  const [term, setTerm] = useState('')
  const [scope, setScope] = useState<ScopeSelection>('all')
  const [page, setPage] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [surface, setSurface] = useState<'dialog' | 'drawer'>('dialog')
  const isAtLeastMd = useMediaQuery('(width >= 48rem)', {})
  if (isAtLeastMd && drawerOpen) setDrawerOpen(false)
  const [activePlugin, setActivePlugin] = useState<Plugin>()
  const inputRef = useRef<HTMLInputElement>(null)
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

  function resetSearch(open: boolean) {
    if (open) return
    setTerm('')
    setScope('all')
    setPage(null)
  }

  useHotkey(
    GOTO_ANYTHING_HOTKEY,
    (event) => {
      if (event.defaultPrevented) return
      const isOpen = gotoAnythingDialogHandle.isOpen || drawerOpen
      if (!isOpen && isEditableShortcutTarget(event.target)) return

      event.preventDefault()
      event.stopPropagation()

      if (isOpen) return
      if (isAtLeastMd) gotoAnythingDialogHandle.open(null)
      else openDrawer(true)
    },
    {
      ignoreInputs: false,
      preventDefault: false,
      stopPropagation: false,
    },
  )

  function openDrawer(open: boolean) {
    if (open) setSurface('drawer')
    setDrawerOpen(open)
  }

  function focusInput() {
    queueMicrotask(() => inputRef.current?.focus())
  }

  function openPage(name: string) {
    setPage(name)
    setScope('all')
    setTerm('')
    focusInput()
  }

  function closePage() {
    setPage(null)
    setTerm('')
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
    closeSearch()
  }

  function clearScope() {
    setScope('all')
    focusInput()
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
        setScope(scopeMatch.scope)
        setTerm(rest)
        focusInput()
        return
      }
      const command = token.startsWith('/') && slashCommandRegistry.findCommand(token.slice(1))
      if (
        command &&
        command.mode === 'submenu' &&
        command.isAvailable?.(commandContext) !== false
      ) {
        setPage(command.name)
        setScope('all')
        setTerm(rest)
        focusInput()
        return
      }
    }
    setTerm(nextTerm)
  }

  function closeSearch() {
    gotoAnythingDialogHandle.close()
    openDrawer(false)
  }

  function handleNavigate(result: SearchResult) {
    closeSearch()

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
    if (eventDetails.reason !== 'item-press') changeTerm(nextValue)
  }

  function selectOption(option: GotoAnythingOption) {
    if (!isCommandOption(option)) handleNavigate(option)
    else if (option.result) handleNavigate(option.result)
    else if (option.scope) {
      setScope(option.scope)
      setTerm('')
      focusInput()
    } else handleCommandSelect(option.shortcut)
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

  let emptyState: 'loading' | 'error' | 'no-commands' | 'no-results' | null = null
  if (isLoading && autocompleteResultCount === 0) emptyState = 'loading'
  else if (isError) emptyState = 'error'
  else if (autocompleteResultCount === 0) emptyState = isCommandsMode ? 'no-commands' : 'no-results'

  const searchTitle = t(($) => $['gotoAnything.searchTitle'], { ns: 'app' })
  const closeLabel = t(($) => $['operation.close'], { ns: 'common' })
  const autocompleteProps = {
    items: visibleOptions,
    value: term,
    onValueChange: handleAutocompleteValueChange,
    itemToStringValue: (option) => option.title,
    filter: null,
    open: true,
    inline: true,
    autoHighlight: 'always',
    keepHighlight: true,
    loopFocus: true,
  } satisfies AutocompleteFlatProps<GotoAnythingOption>
  const searchInputProps = {
    ref: inputRef,
    'aria-label': pageOption?.title ?? scopeOption?.title ?? searchTitle,
    placeholder: pageOption
      ? t(($) => $['placeholder.search'], { ns: 'common' })
      : scopeOption
        ? t(($) => $['gotoAnything.searchInScopePlaceholder'], {
            ns: 'app',
            scope: scopeOption.title,
          })
        : surface === 'dialog'
          ? t(($) => $['gotoAnything.searchOrFilterPlaceholder'], { ns: 'app' })
          : t(($) => $['gotoAnything.searchPlaceholder'], { ns: 'app' }),
    'aria-describedby': searchHintId,
  } satisfies AutocompleteInputProps
  const searchResultsProps = {
    groups: resultGroups,
    label: searchTitle,
    onSelect: selectOption,
    emptyState,
    scope: activeScope,
    error,
    hasPartialFailure: hasUnavailableServices && !isError,
  } satisfies ComponentProps<typeof SearchResults>

  return (
    <>
      <Dialog
        handle={gotoAnythingDialogHandle}
        onOpenChange={(open) => {
          if (open) setSurface('dialog')
        }}
        onOpenChangeComplete={resetSearch}
      >
        <DialogContent
          initialFocus={inputRef}
          onKeyDownCapture={handleKeyDownCapture}
          className="w-140 data-open:transition-none"
          backdropProps={{ className: 'bg-background-overlay-alt data-open:transition-none' }}
        >
          <HotkeysProvider scope={hotkeyScopeId} exclusive>
            <SearchDialogHotkeys />
            <DialogTitle className="sr-only">{searchTitle}</DialogTitle>
            <Autocomplete key={page ?? scope} {...autocompleteProps}>
              <AutocompleteInputGroup
                size="medium"
                // oxlint-disable-next-line shadcn/no-restyle -- The inline command palette keeps focus in search and indicates navigation on the active descendant.
                className="h-auto shrink-0 gap-3 rounded-none border-0 bg-transparent px-4 py-3 hover:bg-transparent has-[input:focus]:bg-transparent has-[input:focus]:ring-0"
              >
                <span
                  aria-hidden
                  className="i-ri-search-line size-4 shrink-0 text-text-quaternary"
                />
                {pageOption ? (
                  <ContextToken title={pageOption.title} onRemove={closePage} />
                ) : (
                  scopeOption && <ContextToken title={scopeOption.title} onRemove={clearScope} />
                )}
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <AutocompleteInput {...searchInputProps} size="medium" className="px-0" />
                </div>
              </AutocompleteInputGroup>
              <SearchAnnouncements
                hintId={searchHintId}
                status={autocompleteStatus}
                describesTokenRemoval
              />
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
                    <SearchResults {...searchResultsProps} />
                  </ScrollAreaContent>
                </ScrollAreaViewport>
                <ScrollAreaScrollbar>
                  <ScrollAreaThumb />
                </ScrollAreaScrollbar>
              </ScrollArea>
            </Autocomplete>
            <DialogClose tabIndex={-1} className="sr-only">
              {closeLabel}
            </DialogClose>
          </HotkeysProvider>
        </DialogContent>
      </Dialog>

      <Drawer
        handle={gotoAnythingDrawerHandle}
        swipeDirection="down"
        open={drawerOpen}
        onOpenChange={openDrawer}
        onOpenChangeComplete={resetSearch}
      >
        <DrawerVirtualKeyboardProvider>
          <DrawerPortal>
            <DrawerBackdrop className="fixed bg-background-overlay-alt" />
            <DrawerViewport>
              <DrawerPopup
                initialFocus={inputRef}
                onKeyDownCapture={handleKeyDownCapture}
                className="h-[min(85dvh,calc(100dvh-3.5rem))]"
              >
                <HotkeysProvider scope={hotkeyScopeId} exclusive>
                  <SearchDialogHotkeys />
                  <DrawerTitle className="sr-only">{searchTitle}</DrawerTitle>
                  <Autocomplete key={page ?? 'home'} {...autocompleteProps}>
                    <div className="shrink-0 px-4 pt-2 pb-3">
                      <div
                        aria-hidden
                        className="mx-auto mb-3 h-1 w-9 rounded-full bg-divider-deep"
                      />
                      <AutocompleteInputGroup
                        size="medium"
                        // oxlint-disable-next-line shadcn/no-restyle -- The sheet's search field is its header, so it is taller than a form input and keeps the ring off while the active descendant shows navigation.
                        className="h-10 gap-2 rounded-[10px] px-3 has-[input:focus]:ring-0"
                      >
                        <span
                          aria-hidden
                          className="i-ri-search-line size-4 shrink-0 text-text-quaternary"
                        />
                        {pageOption && (
                          <ContextToken title={pageOption.title} onRemove={closePage} />
                        )}
                        <AutocompleteInput
                          {...searchInputProps}
                          size="medium"
                          enterKeyHint="go"
                          className="px-0 text-base"
                        />
                        {term && (
                          <AutocompleteClear
                            aria-label={t(($) => $['operation.clear'], { ns: 'common' })}
                          />
                        )}
                      </AutocompleteInputGroup>
                    </div>
                    {!page && (
                      <ScopeBar
                        scopes={allScopeOptions}
                        value={activeScope}
                        onValueChange={setScope}
                      />
                    )}
                    <SearchAnnouncements
                      hintId={searchHintId}
                      status={autocompleteStatus}
                      describesTokenRemoval={Boolean(page)}
                    />
                    <DrawerContent className="overflow-hidden border-t border-divider-subtle">
                      <ScrollArea className="min-h-0 flex-1 overflow-hidden">
                        <ScrollAreaViewport
                          tabIndex={-1}
                          aria-busy={isLoading || undefined}
                          className="scroll-pt-10 overscroll-contain pb-[calc(env(safe-area-inset-bottom)+var(--drawer-keyboard-inset,0px))]"
                        >
                          <ScrollAreaContent
                            className="min-h-full w-full max-w-full"
                            style={{ minWidth: '100%' }}
                          >
                            <SearchResults {...searchResultsProps} />
                          </ScrollAreaContent>
                        </ScrollAreaViewport>
                        <ScrollAreaScrollbar>
                          <ScrollAreaThumb />
                        </ScrollAreaScrollbar>
                      </ScrollArea>
                    </DrawerContent>
                  </Autocomplete>
                  <DrawerClose tabIndex={-1} className="sr-only">
                    {closeLabel}
                  </DrawerClose>
                </HotkeysProvider>
              </DrawerPopup>
            </DrawerViewport>
          </DrawerPortal>
        </DrawerVirtualKeyboardProvider>
      </Drawer>

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
