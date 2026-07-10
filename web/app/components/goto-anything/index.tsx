'use client'

import type { FC, KeyboardEvent } from 'react'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { Command } from 'cmdk'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { PluginInstallPermissionProvider } from '../plugins/install-plugin/components/plugin-install-permission-provider'
import useWorkspacePluginInstallPermission from '../plugins/install-plugin/hooks/use-workspace-plugin-install-permission'
import InstallFromMarketplace from '../plugins/install-plugin/install-from-marketplace'
import { slashCommandRegistry } from './actions/commands/registry'
import { SlashCommandProvider } from './actions/commands/slash-provider'
import CommandSelector from './command-selector'
import { EmptyState, Footer, ResultList, SearchInput } from './components'
import { GotoAnythingProvider, useGotoAnythingContext } from './context'
import { useGotoAnythingModal } from './hooks/use-goto-anything-modal'
import { useGotoAnythingNavigation } from './hooks/use-goto-anything-navigation'
import { useGotoAnythingResults } from './hooks/use-goto-anything-results'
import { useGotoAnythingSearch } from './hooks/use-goto-anything-search'

type Props = Readonly<{
  onHide?: () => void
}>

const GotoAnythingDialog: FC<Props> = ({
  onHide,
}) => {
  const { t } = useTranslation()
  const { isWorkflowPage, isRagPipelinePage } = useGotoAnythingContext()
  const { canInstallPlugin, currentDifyVersion } = useWorkspacePluginInstallPermission()
  const prevShowRef = useRef(false)

  // Search state management (called first so setSearchQuery is available)
  const {
    searchQuery,
    setSearchQuery,
    searchQueryDebouncedValue,
    searchMode,
    isCommandsMode,
    cmdVal,
    setCmdVal,
    clearSelection,
    Actions,
  } = useGotoAnythingSearch()

  // Modal state management
  const {
    open,
    onOpenChange,
    inputRef,
  } = useGotoAnythingModal()

  // Reset state when modal opens/closes
  useEffect(() => {
    if (open && !prevShowRef.current) {
      // Modal just opened - reset search
      setSearchQuery('')
    }
    else if (!open && prevShowRef.current) {
      // Modal just closed
      setSearchQuery('')
      clearSelection()
      onHide?.()
    }
    prevShowRef.current = open
  }, [open, setSearchQuery, clearSelection, onHide])

  // Results fetching and processing
  const {
    dedupedResults,
    groupedResults,
    isLoading,
    isError,
    error,
  } = useGotoAnythingResults({
    searchQueryDebouncedValue,
    searchMode,
    isCommandsMode,
    Actions,
    isWorkflowPage,
    isRagPipelinePage,
    cmdVal,
    setCmdVal,
  })

  // Navigation handlers
  const {
    handleCommandSelect,
    handleNavigate,
    activePlugin,
    setActivePlugin,
  } = useGotoAnythingNavigation({
    Actions,
    setSearchQuery,
    clearSelection,
    inputRef,
    onClose: () => onOpenChange(false),
  })

  // Handle search input change
  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value)
    if (!value.startsWith('@') && !value.startsWith('/'))
      clearSelection()
  }, [setSearchQuery, clearSelection])

  // Handle search input keydown for slash commands
  const handleSearchKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const query = searchQuery.trim()
      // Check if it's a complete slash command
      if (query.startsWith('/')) {
        const commandName = query.substring(1).split(' ')[0]
        const handler = slashCommandRegistry.findCommand(commandName!)

        // If it's a direct mode command, execute immediately
        const isAvailable = handler?.isAvailable?.() ?? true
        if (handler?.mode === 'direct' && handler.execute && isAvailable) {
          e.preventDefault()
          handler.execute()
          onOpenChange(false)
          setSearchQuery('')
        }
      }
    }
  }, [searchQuery, onOpenChange, setSearchQuery])

  // Determine which empty state to show
  const emptyStateVariant = useMemo(() => {
    if (isLoading)
      return 'loading'
    if (isError)
      return 'error'
    if (!searchQuery.trim()) {
      // Show default hint only when there are no recent items to display
      return dedupedResults.length === 0 ? 'default' : null
    }
    if (dedupedResults.length === 0 && !isCommandsMode)
      return 'no-results'
    return null
  }, [isLoading, isError, searchQuery, dedupedResults.length, isCommandsMode])

  return (
    <>
      <SlashCommandProvider />
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
      >
        <DialogContent className="w-[480px]! overflow-hidden p-0!">
          <Command
            className="outline-hidden"
            value={cmdVal}
            onValueChange={setCmdVal}
            disablePointerSelection
            loop
          >
            <SearchInput
              inputRef={inputRef}
              value={searchQuery}
              onChange={handleSearchChange}
              onKeyDown={handleSearchKeyDown}
              searchMode={searchMode}
              placeholder={t($ => $['gotoAnything.searchPlaceholder'], { ns: 'app' })}
            />

            <Command.List className="h-[240px] overflow-y-auto">
              {emptyStateVariant === 'loading' && (
                <EmptyState variant="loading" />
              )}

              {emptyStateVariant === 'error' && (
                <EmptyState variant="error" error={error} />
              )}

              {!isLoading && !isError && (
                <>
                  {isCommandsMode
                    ? (
                        <CommandSelector
                          actions={Actions}
                          onCommandSelect={handleCommandSelect}
                          searchFilter={searchQuery.trim().substring(1)}
                          commandValue={cmdVal}
                          onCommandValueChange={setCmdVal}
                          originalQuery={searchQuery.trim()}
                        />
                      )
                    : (
                        <ResultList
                          groupedResults={groupedResults}
                          onSelect={handleNavigate}
                        />
                      )}

                  {!isCommandsMode && emptyStateVariant === 'no-results' && (
                    <EmptyState
                      variant="no-results"
                      searchMode={searchMode}
                      Actions={Actions}
                    />
                  )}

                  {!isCommandsMode && emptyStateVariant === 'default' && (
                    <EmptyState variant="default" />
                  )}
                </>
              )}
            </Command.List>

            <Footer
              resultCount={dedupedResults.length}
              searchMode={searchMode}
              isError={isError}
              isCommandsMode={isCommandsMode}
              hasQuery={!!searchQuery.trim()}
            />
          </Command>
        </DialogContent>
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

export const GotoAnything: FC<Props> = (props) => {
  return (
    <GotoAnythingProvider>
      <GotoAnythingDialog {...props} />
    </GotoAnythingProvider>
  )
}
