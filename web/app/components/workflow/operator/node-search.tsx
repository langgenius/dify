import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNodes } from 'reactflow'
import { useKeyPress } from 'ahooks'
import Input from '@/app/components/base/input'
import { useNodesInteractions, useToolIcon } from '../hooks'
import BlockIcon from '../block-icon'
import { useStore } from '../store'
import { getKeyboardKeyCodeBySystem, isEventTargetInputArea } from '../utils'
import cn from '@/utils/classnames'
import { PortalToFollowElem, PortalToFollowElemContent, PortalToFollowElemTrigger } from '@/app/components/base/portal-to-follow-elem'

const SearchResultItem = ({ node, searchQuery, isSelected, onClick, highlightMatch }: any) => {
  const toolIcon = useToolIcon(node.nodeData)

  return (
    <div
      className={cn(
        'flex cursor-pointer items-center gap-3 rounded-md p-2 hover:bg-state-base-hover',
        isSelected && 'bg-state-base-hover ring-1 ring-blue-500',
      )}
      onClick={onClick}
    >
      <BlockIcon
        type={node.blockType}
        toolIcon={toolIcon}
        className='shrink-0'
        size='sm'
      />
      <div className='min-w-0 flex-1'>
        <div className='truncate font-medium text-text-secondary'>
          {highlightMatch(node.title, searchQuery)}
        </div>
        <div className='truncate text-xs text-text-quaternary'>
          {highlightMatch(node.type, searchQuery)}
        </div>
        {node.desc && (
          <div className='mt-0.5 truncate text-xs text-text-quaternary'>
            {highlightMatch(node.desc, searchQuery)}
          </div>
        )}
      </div>
    </div>
  )
}

const NodeSearch = () => {
  const { t } = useTranslation()
  const nodes = useNodes()
  const [searchQuery, setSearchQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const { handleNodeSelect } = useNodesInteractions()
  const workflowCanvasWidth = useStore(s => s.workflowCanvasWidth)
  const resultsRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const isMac = useMemo(() => {
    return typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC')
  }, [])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      if (
        resultsRef.current
        && !resultsRef.current.contains(target)
        && inputRef.current
        && !inputRef.current.contains(target)
      ) {
        setIsOpen(false)
        setSelectedIndex(-1)
      }
    }

    if (isOpen)
      document.addEventListener('mousedown', handleClickOutside)

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  useEffect(() => {
    if (searchQuery.trim())
      setIsOpen(true)
  }, [searchQuery])

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

  const searchableNodes = useMemo(() => {
    const filteredNodes = nodes.filter((node) => {
      return node.id && node.data && node.type !== 'sticky'
    })

    const result = filteredNodes
      .map((node) => {
        const nodeData = node.data as any

        const processedNode = {
          id: node.id,
          title: nodeData?.title || nodeData?.type || 'Untitled',
          type: nodeData?.type || '',
          desc: nodeData?.desc || '',
          blockType: nodeData?.type,
          nodeData,
        }

        return processedNode
      })

    return result
  }, [nodes])

  const filteredResults = useMemo(() => {
    if (!searchQuery.trim()) return []

    const query = searchQuery.toLowerCase()

    const results = searchableNodes
      .map((node) => {
        const titleMatch = node.title.toLowerCase()
        const typeMatch = node.type.toLowerCase()
        const descMatch = node.desc.toLowerCase()

        let score = 0

        if (titleMatch.startsWith(query)) score += 100
        else if (titleMatch.includes(query)) score += 50
        else if (typeMatch === query) score += 80
        else if (typeMatch.includes(query)) score += 30
        else if (descMatch.includes(query)) score += 20

        return score > 0 ? { ...node, score } : null
      })
      .filter((node): node is NonNullable<typeof node> => node !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)

    return results
  }, [searchableNodes, searchQuery])

  const handleFocusSearch = useCallback((e: KeyboardEvent) => {
    if (isEventTargetInputArea(e.target as HTMLElement))
      return
    e.preventDefault()
    inputRef.current?.focus()
  }, [])

  useKeyPress(`${getKeyboardKeyCodeBySystem('ctrl')}.k`, handleFocusSearch, {
    exactMatch: true,
    useCapture: true,
  })

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen || filteredResults.length === 0) return

      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault()
          setSelectedIndex(prev =>
            prev < filteredResults.length - 1 ? prev + 1 : 0,
          )
          break
        }
        case 'ArrowUp': {
          e.preventDefault()
          setSelectedIndex(prev =>
            prev > 0 ? prev - 1 : filteredResults.length - 1,
          )
          break
        }
        case 'Enter': {
          e.preventDefault()
          if (selectedIndex >= 0 && filteredResults[selectedIndex]) {
            handleNodeSelect(filteredResults[selectedIndex].id)
            setSearchQuery('')
            setIsOpen(false)
            setSelectedIndex(-1)
          }
          break
        }
        case 'Escape': {
          e.preventDefault()
          setSearchQuery('')
          setIsOpen(false)
          setSelectedIndex(-1)
          break
        }
        default:
          break
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, filteredResults, selectedIndex, handleNodeSelect])

  useEffect(() => {
    setSelectedIndex(-1)
  }, [searchQuery])

  useEffect(() => {
    if (selectedIndex >= 0 && resultsRef.current) {
      const listContainer = resultsRef.current.children[0] as HTMLElement | undefined
      const selectedElement = listContainer?.children[selectedIndex] as HTMLElement | undefined
      if (selectedElement)
        selectedElement.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  const handleInputBlur = useCallback(() => {
    setTimeout(() => {
      setIsOpen(false)
      setSelectedIndex(-1)
    }, 200)
  }, [])

  const maxResultsWidth = Math.min((workflowCanvasWidth || 800) - 40, 320)

  return (
    <div className='relative'>
      <PortalToFollowElem
        placement='bottom-start'
        open={isOpen && searchQuery.trim().length > 0}
        onOpenChange={setIsOpen}
      >
        <PortalToFollowElemTrigger>
          <div className='relative'>
            <Input
              ref={inputRef}
              wrapperClassName='w-[240px]'
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value)
                setIsOpen(true)
              }}
              onFocus={() => setIsOpen(true)}
              onBlur={handleInputBlur}
              onClear={() => setSearchQuery('')}
              placeholder={t('workflow.operator.searchNodesShortcut', {
                shortcut: isMac ? 'Cmd+K' : 'Ctrl+K',
              })}
              showLeftIcon
              showClearIcon
              className='text-sm'
            />
          </div>
        </PortalToFollowElemTrigger>

        <PortalToFollowElemContent
          style={{
            width: `${maxResultsWidth}px`,
            zIndex: 1000,
          }}
        >
          <div className='max-h-80 overflow-hidden rounded-lg border border-divider-regular bg-components-panel-bg shadow-lg'>
            {filteredResults.length > 0 ? (
              <div ref={resultsRef} className='max-h-80 overflow-y-auto'>
                <div className='p-1'>
                  {filteredResults.map((node, index) => (
                    <SearchResultItem
                      key={node.id}
                      node={node}
                      searchQuery={searchQuery}
                      isSelected={selectedIndex === index}
                      onClick={() => {
                        handleNodeSelect(node.id)
                        setSearchQuery('')
                        setIsOpen(false)
                        setSelectedIndex(-1)
                      }}
                      highlightMatch={highlightMatch}
                    />
                  ))}
                </div>
                <div className='border-t border-divider-subtle bg-gray-50 px-3 py-2 text-xs text-text-tertiary'>
                  <div className='flex items-center justify-between'>
                    <span>{t('workflow.operator.searchResults', { count: filteredResults.length })}</span>
                    <span className='text-xs'>
                      ↑↓ {t('workflow.operator.navigate')} • ↵ {t('workflow.operator.select')} • ⎋ {t('workflow.operator.close')}
                    </span>
                  </div>
                </div>
              </div>
            ) : searchQuery.trim() && (
              <div className='p-8 text-center text-text-tertiary'>
                <div className='text-sm'>{t('workflow.operator.noNodesFound')}</div>
                <div className='mt-1 text-xs'>{t('workflow.operator.searchHint')}</div>
              </div>
            )}
          </div>
        </PortalToFollowElemContent>
      </PortalToFollowElem>
    </div>
  )
}

export default NodeSearch
