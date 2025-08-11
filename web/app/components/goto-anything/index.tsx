'use client'

import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Modal from '@/app/components/base/modal'
import Input from '@/app/components/base/input'
import { useDebounce, useKeyPress } from 'ahooks'
import { getKeyboardKeyCodeBySystem, isEventTargetInputArea, isMac } from '@/app/components/workflow/utils/common'
import { selectWorkflowNode } from '@/app/components/workflow/utils/node-navigation'
import { RiSearchLine } from '@remixicon/react'
import { Actions as AllActions, type SearchResult, matchAction, searchAnything } from './actions'
import { GotoAnythingProvider, useGotoAnythingContext } from './context'
import { useQuery } from '@tanstack/react-query'
import { useGetLanguage } from '@/context/i18n'
import { useTranslation } from 'react-i18next'
import InstallFromMarketplace from '../plugins/install-plugin/install-from-marketplace'
import type { Plugin } from '../plugins/types'
import { Command } from 'cmdk'
import CommandSelector from './command-selector'

type Props = {
  onHide?: () => void
}
const GotoAnything: FC<Props> = ({
  onHide,
}) => {
  const router = useRouter()
  const defaultLocale = useGetLanguage()
  const { isWorkflowPage } = useGotoAnythingContext()
  const { t } = useTranslation()
  const [show, setShow] = useState<boolean>(false)
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [cmdVal, setCmdVal] = useState<string>('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Filter actions based on context
  const Actions = useMemo(() => {
    // Create a filtered copy of actions based on current page context
    if (isWorkflowPage) {
      // Include all actions on workflow pages
      return AllActions
    }
    else {
      // Exclude node action on non-workflow pages
      const { app, knowledge, plugin } = AllActions
      return { app, knowledge, plugin }
    }
  }, [isWorkflowPage])

  const [activePlugin, setActivePlugin] = useState<Plugin>()

  // Handle keyboard shortcuts
  const handleToggleModal = useCallback((e: KeyboardEvent) => {
    // Allow closing when modal is open, even if focus is in the search input
    if (!show && isEventTargetInputArea(e.target as HTMLElement))
      return
    e.preventDefault()
    setShow((prev) => {
      if (!prev) {
        // Opening modal - reset search state
        setSearchQuery('')
      }
      return !prev
    })
  }, [show])

  useKeyPress(`${getKeyboardKeyCodeBySystem('ctrl')}.k`, handleToggleModal, {
    exactMatch: true,
    useCapture: true,
  })

  useKeyPress(['esc'], (e) => {
    if (show) {
      e.preventDefault()
      setShow(false)
      setSearchQuery('')
    }
  })

  const searchQueryDebouncedValue = useDebounce(searchQuery.trim(), {
    wait: 300,
  })

  const isCommandsMode = searchQuery.trim() === '@'

  const searchMode = useMemo(() => {
    if (isCommandsMode) return 'commands'

    const query = searchQueryDebouncedValue.toLowerCase()
    const action = matchAction(query, Actions)
    return action ? action.key : 'general'
  }, [searchQueryDebouncedValue, Actions, isCommandsMode])

  const { data: searchResults = [], isLoading, isError, error } = useQuery(
    {
      queryKey: [
        'goto-anything',
        'search-result',
        searchQueryDebouncedValue,
        searchMode,
        isWorkflowPage,
        defaultLocale,
        Object.keys(Actions).sort().join(','),
      ],
      queryFn: async () => {
        const query = searchQueryDebouncedValue.toLowerCase()
        const action = matchAction(query, Actions)
        return await searchAnything(defaultLocale, query, action)
      },
      enabled: !!searchQueryDebouncedValue && !isCommandsMode,
      staleTime: 30000,
      gcTime: 300000,
    },
  )

  const handleCommandSelect = useCallback((commandKey: string) => {
    setSearchQuery(`${commandKey} `)
    setCmdVal('')
    setTimeout(() => {
      inputRef.current?.focus()
    }, 0)
  }, [])

  // Handle navigation to selected result
  const handleNavigate = useCallback((result: SearchResult) => {
    setShow(false)
    setSearchQuery('')

    switch (result.type) {
      case 'plugin':
        setActivePlugin(result.data)
        break
      case 'workflow-node':
        // Handle workflow node selection and navigation
        if (result.metadata?.nodeId)
          selectWorkflowNode(result.metadata.nodeId, true)

        break
      default:
        if (result.path)
          router.push(result.path)
    }
  }, [router])

  // Group results by type
  const groupedResults = useMemo(() => searchResults.reduce((acc, result) => {
    if (!acc[result.type])
      acc[result.type] = []

    acc[result.type].push(result)
    return acc
  }, {} as { [key: string]: SearchResult[] }),
    [searchResults])

  const emptyResult = useMemo(() => {
    if (searchResults.length || !searchQuery.trim() || isLoading || isCommandsMode)
      return null

    const isCommandSearch = searchMode !== 'general'
    const commandType = isCommandSearch ? searchMode.replace('@', '') : ''

    if (isError) {
      return (
        <div className="flex items-center justify-center py-8 text-center text-text-tertiary">
          <div>
            <div className='text-sm font-medium text-red-500'>{t('app.gotoAnything.searchTemporarilyUnavailable')}</div>
            <div className='mt-1 text-xs text-text-quaternary'>
              {t('app.gotoAnything.servicesUnavailableMessage')}
            </div>
          </div>
        </div>
      )
    }

    return (
      <div className="flex items-center justify-center py-8 text-center text-text-tertiary">
        <div>
          <div className='text-sm font-medium'>
            {isCommandSearch
              ? (() => {
                const keyMap: Record<string, string> = {
                  app: 'app.gotoAnything.emptyState.noAppsFound',
                  plugin: 'app.gotoAnything.emptyState.noPluginsFound',
                  knowledge: 'app.gotoAnything.emptyState.noKnowledgeBasesFound',
                  node: 'app.gotoAnything.emptyState.noWorkflowNodesFound',
                }
                return t(keyMap[commandType] || 'app.gotoAnything.noResults')
              })()
              : t('app.gotoAnything.noResults')
            }
          </div>
          <div className='mt-1 text-xs text-text-quaternary'>
            {isCommandSearch
              ? t('app.gotoAnything.emptyState.tryDifferentTerm', { mode: searchMode })
              : t('app.gotoAnything.emptyState.trySpecificSearch', { shortcuts: Object.values(Actions).map(action => action.shortcut).join(', ') })
            }
          </div>
        </div>
      </div>
    )
  }, [searchResults, searchQuery, Actions, searchMode, isLoading, isError, isCommandsMode])

  const defaultUI = useMemo(() => {
    if (searchQuery.trim())
      return null

    return (<div className="flex items-center justify-center py-12 text-center text-text-tertiary">
      <div>
        <div className='text-sm font-medium'>{t('app.gotoAnything.searchTitle')}</div>
        <div className='mt-3 space-y-1 text-xs text-text-quaternary'>
          <div>{t('app.gotoAnything.searchHint')}</div>
          <div>{t('app.gotoAnything.commandHint')}</div>
        </div>
      </div>
    </div>)
  }, [searchQuery, Actions])

  useEffect(() => {
    if (show) {
      requestAnimationFrame(() => {
        inputRef.current?.focus()
      })
    }
    return () => {
      setCmdVal('')
    }
  }, [show])

  return (
    <>
      <Modal
        isShow={show}
        onClose={() => {
          setShow(false)
          setSearchQuery('')
          onHide?.()
        }}
        closable={false}
        className='!w-[480px] !p-0'
      >
        <div className='flex flex-col rounded-2xl border border-components-panel-border bg-components-panel-bg shadow-xl'>
          <Command
            className='outline-none'
            value={cmdVal}
            onValueChange={setCmdVal}
          >
            <div className='flex items-center gap-3 border-b border-divider-subtle bg-components-panel-bg-blur px-4 py-3'>
              <RiSearchLine className='h-4 w-4 text-text-quaternary' />
              <div className='flex flex-1 items-center gap-2'>
                <Input
                  ref={inputRef}
                  value={searchQuery}
                  placeholder={t('app.gotoAnything.searchPlaceholder')}
                  onChange={(e) => {
                    setCmdVal('')
                    setSearchQuery(e.target.value)
                  }}
                  className='flex-1 !border-0 !bg-transparent !shadow-none'
                  wrapperClassName='flex-1 !border-0 !bg-transparent'
                  autoFocus
                />
                {searchMode !== 'general' && (
                  <div className='flex items-center gap-1 rounded bg-blue-50 px-2 py-[2px] text-xs font-medium text-blue-600 dark:bg-blue-900/40 dark:text-blue-300'>
                    <span>{searchMode.replace('@', '').toUpperCase()}</span>
                  </div>
                )}
              </div>
              <div className='text-xs text-text-quaternary'>
                <span className='system-kbd rounded bg-gray-200 px-1 py-[2px] font-mono text-gray-700 dark:bg-gray-800 dark:text-gray-100'>
                  {isMac() ? '⌘' : 'Ctrl'}
                </span>
                <span className='system-kbd ml-1 rounded bg-gray-200 px-1 py-[2px] font-mono text-gray-700 dark:bg-gray-800 dark:text-gray-100'>
                  K
                </span>
              </div>
            </div>

            <Command.List className='max-h-[275px] min-h-[240px] overflow-y-auto'>
              {isLoading && (
                <div className="flex items-center justify-center py-8 text-center text-text-tertiary">
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600"></div>
                    <span className="text-sm">{t('app.gotoAnything.searching')}</span>
                  </div>
                </div>
              )}
              {isError && (
                <div className="flex items-center justify-center py-8 text-center text-text-tertiary">
                  <div>
                    <div className="text-sm font-medium text-red-500">{t('app.gotoAnything.searchFailed')}</div>
                    <div className="mt-1 text-xs text-text-quaternary">
                      {error.message}
                    </div>
                  </div>
                </div>
              )}
              {!isLoading && !isError && (
                <>
                  {isCommandsMode ? (
                    <CommandSelector
                      actions={Actions}
                      onCommandSelect={handleCommandSelect}
                    />
                  ) : (
                    Object.entries(groupedResults).map(([type, results], groupIndex) => (
                    <Command.Group key={groupIndex} heading={(() => {
                      const typeMap: Record<string, string> = {
                        'app': 'app.gotoAnything.groups.apps',
                        'plugin': 'app.gotoAnything.groups.plugins',
                        'knowledge': 'app.gotoAnything.groups.knowledgeBases',
                        'workflow-node': 'app.gotoAnything.groups.workflowNodes',
                      }
                      return t(typeMap[type] || `${type}s`)
                    })()} className='p-2 capitalize text-text-secondary'>
                      {results.map(result => (
                        <Command.Item
                          key={`${result.type}-${result.id}`}
                          value={result.title}
                          className='flex cursor-pointer items-center gap-3 rounded-md p-3 will-change-[background-color] aria-[selected=true]:bg-state-base-hover data-[selected=true]:bg-state-base-hover'
                          onSelect={() => handleNavigate(result)}
                        >
                          {result.icon}
                          <div className='min-w-0 flex-1'>
                            <div className='truncate font-medium text-text-secondary'>
                              {result.title}
                            </div>
                            {result.description && (
                              <div className='mt-0.5 truncate text-xs text-text-quaternary'>
                                {result.description}
                              </div>
                            )}
                          </div>
                          <div className='text-xs capitalize text-text-quaternary'>
                            {result.type}
                          </div>
                        </Command.Item>
                      ))}
                    </Command.Group>
                  ))
                  )}
                  {!isCommandsMode && emptyResult}
                  {!isCommandsMode && defaultUI}
                </>
              )}
            </Command.List>

            {(!!searchResults.length || isError) && (
              <div className='border-t border-divider-subtle bg-components-panel-bg-blur px-4 py-2 text-xs text-text-tertiary'>
                <div className='flex items-center justify-between'>
                  <span>
                    {isError ? (
                      <span className='text-red-500'>{t('app.gotoAnything.someServicesUnavailable')}</span>
                    ) : (
                      <>
                        {t('app.gotoAnything.resultCount', { count: searchResults.length })}
                        {searchMode !== 'general' && (
                          <span className='ml-2 opacity-60'>
{t('app.gotoAnything.inScope', { scope: searchMode.replace('@', '') })}
                          </span>
                        )}
                      </>
                    )}
                  </span>
                  <span className='opacity-60'>
                    {searchMode !== 'general'
                      ? t('app.gotoAnything.clearToSearchAll')
                      : t('app.gotoAnything.useAtForSpecific')
                    }
                  </span>
                </div>
              </div>
            )}
          </Command>
        </div>

      </Modal>
      {
        activePlugin && (
          <InstallFromMarketplace
            manifest={activePlugin}
            uniqueIdentifier={activePlugin.latest_package_identifier}
            onClose={() => setActivePlugin(undefined)}
            onSuccess={() => setActivePlugin(undefined)}
          />
        )
      }
    </>
  )
}

/**
 * GotoAnything component with context provider
 */
const GotoAnythingWithContext: FC<Props> = (props) => {
  return (
    <GotoAnythingProvider>
      <GotoAnything {...props} />
    </GotoAnythingProvider>
  )
}

export default GotoAnythingWithContext
