'use client'

import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Modal from '@/app/components/base/modal'
import Input from '@/app/components/base/input'
import { useDebounce, useKeyPress } from 'ahooks'
import { getKeyboardKeyCodeBySystem, isEventTargetInputArea, isMac } from '@/app/components/workflow/utils/common'
import { RiSearchLine } from '@remixicon/react'
import cn from '@/utils/classnames'
import { Actions, type SearchResult, matchAction, searchAnything } from './actions'
import { useQuery } from '@tanstack/react-query'
import { useGetLanguage } from '@/context/i18n'
import InstallFromMarketplace from '../plugins/install-plugin/install-from-marketplace'
import type { Plugin } from '../plugins/types'

type Props = {
  onHide?: () => void
}
const GotoAnything: FC<Props> = ({
  onHide,
}) => {
  const router = useRouter()
  const defaultLocale = useGetLanguage()
  const [show, setShow] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const [activePlugin, setActivePlugin] = useState<Plugin>()

  // Handle keyboard shortcuts
  const handleToggleModal = useCallback((e: KeyboardEvent) => {
    if (isEventTargetInputArea(e.target as HTMLElement))
      return
    e.preventDefault()
    setShow((prev) => {
      if (!prev) {
        // Opening modal - reset search state
        setSearchQuery('')
      }
      return !prev
    })
  }, [])

  useKeyPress(`${getKeyboardKeyCodeBySystem('ctrl')}.g`, handleToggleModal, {
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

  const { data: searchResults = [], isLoading, isError, error } = useQuery(
    {
      queryKey: ['goto-anything', 'search-result', searchQueryDebouncedValue],
      queryFn: async () => {
        const query = searchQueryDebouncedValue.toLowerCase()

        // Handle @ commands using Actions
        const action = matchAction(query, Actions)

        return await searchAnything(query, action, defaultLocale)
      },
      placeholderData: (previousData) => {
        if (searchQueryDebouncedValue)
          return previousData

        return []
      },
      enabled: !!searchQueryDebouncedValue,
    },
  )

  // Handle navigation to selected result
  const handleNavigate = useCallback((result: SearchResult) => {
    if (result.path)
      router.push(result.path)
    setShow(false)
    setSearchQuery('')

    switch (result.type) {
      case 'plugin':
        setActivePlugin(result.data)
    }
  }, [router])

  // Highlight matching text
  const highlightMatch = useCallback((text: string, query: string) => {
    if (!query.trim()) return text

    const safeQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(`(${safeQuery})`, 'gi')
    const parts = text.split(regex)

    return parts.map((part, index) =>
      regex.test(part) ? (
        <mark key={index} className='rounded bg-yellow-200 px-0.5 text-yellow-900'>
          {part}
        </mark>
      ) : part,
    )
  }, [])

  const searchResult = useMemo(() => {
    if (!searchResults.length)
      return null

    return (
      <div className='p-2'>
        {searchResults.map(result => (
          <div
            key={`${result.type}-${result.id}`}
            className={cn(
              'flex cursor-pointer items-center gap-3 rounded-md p-3 hover:bg-state-base-hover',
            )}
            onClick={() => handleNavigate(result)}
          >
            {result.icon}
            <div className='min-w-0 flex-1'>
              <div className='truncate font-medium text-text-secondary'>
                {highlightMatch(result.title, searchQueryDebouncedValue.replace(/@\w+\s*/, ''))}
              </div>
              {result.description && (
                <div className='mt-0.5 truncate text-xs text-text-quaternary'>
                  {highlightMatch(result.description, searchQueryDebouncedValue.replace(/@\w+\s*/, ''))}
                </div>
              )}
            </div>
            <div className='text-xs capitalize text-text-quaternary'>
              {result.type}
            </div>
          </div>
        ))}
      </div>
    )
  }, [searchResults])

  const emptyResult = useMemo(() => {
    if (searchResults.length || !searchQueryDebouncedValue.trim())
      return null

    return (<div className="flex items-center justify-center py-12 text-center text-text-tertiary">
      <div>
        <div className='text-sm font-medium'>No results found</div>
        <div className='mt-1 text-xs text-text-quaternary'>
          Try {Object.values(Actions).map(action => action.shortcut).join(', ')} for specific searches
        </div>
      </div>
    </div>)
  }, [searchResults, searchQueryDebouncedValue])

  const defaultUI = useMemo(() => {
    if (searchQueryDebouncedValue.trim())
      return null

    return (<div className="flex items-center justify-center py-12 text-center text-text-tertiary">
      <div>
        <div className='text-sm font-medium'>Search for anything</div>
        <div className='mt-2 space-y-1 text-xs text-text-quaternary'>
          {Object.values(Actions).map(action => (
            <div key={action.key}>
              <span className='rounded bg-gray-200 px-1.5 py-0.5 font-mono text-gray-400 dark:bg-gray-300 dark:text-gray-700'>{action.shortcut}</span>{' '}
              {action.description}
            </div>
          ))}
        </div>
      </div>
    </div>)
  }, [searchResults, searchQueryDebouncedValue])

  useEffect(() => {
    if (show) {
      requestAnimationFrame(() => {
        inputRef.current?.focus()
      })
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
          <div className='flex items-center gap-3 border-b border-divider-subtle bg-gray-50/50 px-4 py-3 dark:bg-gray-300/50'>
            <RiSearchLine className="h-4 w-4 text-text-quaternary" />
            <Input
              ref={inputRef}
              value={searchQuery}
              placeholder='Search or type @ for commands...'
              onChange={(e) => {
                setSearchQuery(e.target.value)
              }}
              className='flex-1 !border-0 !bg-transparent !shadow-none'
              wrapperClassName='flex-1 !border-0 !bg-transparent'
              autoFocus
            />
            <div className='text-xs text-text-quaternary'>
              <span className='rounded bg-gray-200 px-1.5 py-0.5 font-mono text-gray-700 dark:bg-gray-700 dark:text-gray-300'>
                {isMac() ? '⌘G' : 'Ctrl+G'}
              </span>
            </div>
          </div>

          <div className='max-h-96 min-h-[240px] overflow-y-auto'>
            {isLoading && (
              <div className="flex items-center justify-center py-12 text-center text-text-tertiary">
                <div className="flex items-center gap-2">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600"></div>
                  <span className="text-sm">Searching...</span>
                </div>
              </div>
            )}
            {isError && (
              <div className="flex items-center justify-center py-12 text-center text-text-tertiary">
                <div>
                  <div className="text-sm font-medium text-red-500">Search failed</div>
                  <div className="mt-1 text-xs text-text-quaternary">
                    {error.message}
                  </div>
                </div>
              </div>
            )}
            {!isLoading && !isError && (
              <>
                {searchResult}
                {emptyResult}
                {defaultUI}
              </>
            )}
          </div>

          {!!searchResults.length && (
            <div className='border-t border-divider-subtle bg-gray-100/80 px-4 py-2 text-xs text-text-tertiary dark:bg-gray-800/80'>
              <div className='flex items-center justify-between'>
                <span>{searchResults.length} result{searchResults.length !== 1 ? 's' : ''}</span>
                <span></span>
              </div>
            </div>
          )}
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

export default GotoAnything
