'use client'
import type { FC } from 'react'
import type { BlockEnum } from '@/app/components/workflow/types'
import * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Input from '@/app/components/base/input'
import BlockIcon from '@/app/components/workflow/block-icon'
import { cn } from '@/utils/classnames'

export type AgentNode = {
  id: string
  title: string
  type: BlockEnum
}

type ItemProps = {
  node: AgentNode
  onSelect: (node: AgentNode) => void
  isHighlighted?: boolean
  onSetHighlight?: () => void
  registerRef?: (element: HTMLButtonElement | null) => void
}

const Item: FC<ItemProps> = ({ node, onSelect, isHighlighted, onSetHighlight, registerRef }) => {
  const [isHovering, setIsHovering] = useState(false)

  return (
    <button
      type="button"
      className={cn(
        'relative flex h-6 w-full cursor-pointer items-center rounded-md border-none bg-transparent px-3 text-left',
        (isHovering || isHighlighted) && 'bg-state-base-hover',
      )}
      ref={registerRef}
      onMouseEnter={() => {
        setIsHovering(true)
        onSetHighlight?.()
      }}
      onMouseLeave={() => setIsHovering(false)}
      onFocus={onSetHighlight}
      onClick={() => onSelect(node)}
      onMouseDown={e => e.preventDefault()}
    >
      <BlockIcon
        className="mr-1 shrink-0"
        type={node.type}
        size="xs"
      />
      <span
        className="system-sm-medium truncate text-text-secondary"
        title={node.title}
      >
        {node.title}
      </span>
    </button>
  )
}

type Props = {
  nodes: AgentNode[]
  onSelect: (node: AgentNode) => void
  onClose?: () => void
  onBlur?: () => void
  hideSearch?: boolean
  searchBoxClassName?: string
  maxHeightClass?: string
  autoFocus?: boolean
  externalSearchText?: string
  enableKeyboardNavigation?: boolean
}

const AgentNodeList: FC<Props> = ({
  nodes,
  onSelect,
  onClose,
  onBlur,
  hideSearch,
  searchBoxClassName,
  maxHeightClass,
  autoFocus = true,
  externalSearchText,
  enableKeyboardNavigation = false,
}) => {
  const { t } = useTranslation()
  const [searchText, setSearchText] = useState('')
  const normalizedSearchText = externalSearchText === undefined ? searchText : externalSearchText.trim()
  const shouldShowSearchInput = !hideSearch && externalSearchText === undefined

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose?.()
    }
  }

  const filteredNodes = useMemo(() => nodes.filter((node) => {
    if (!normalizedSearchText)
      return true
    return node.title.toLowerCase().includes(normalizedSearchText.toLowerCase())
  }), [nodes, normalizedSearchText])

  const [activeIndex, setActiveIndex] = useState(-1)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])

  useEffect(() => {
    itemRefs.current = []
  }, [filteredNodes.length])

  useEffect(() => {
    if (!enableKeyboardNavigation) {
      setActiveIndex(-1)
      return
    }
    if (filteredNodes.length === 0) {
      setActiveIndex(-1)
      return
    }
    setActiveIndex(0)
  }, [enableKeyboardNavigation, filteredNodes.length, normalizedSearchText])

  useEffect(() => {
    if (!enableKeyboardNavigation || activeIndex < 0)
      return
    const target = itemRefs.current[activeIndex]
    if (target)
      target.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, enableKeyboardNavigation, filteredNodes.length])

  const handleSelectItem = useCallback((node: AgentNode) => {
    onSelect(node)
  }, [onSelect])

  useEffect(() => {
    if (!enableKeyboardNavigation)
      return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (filteredNodes.length === 0)
        return
      if (!['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key))
        return
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') {
        onClose?.()
        return
      }
      if (event.key === 'Enter') {
        if (activeIndex < 0 || activeIndex >= filteredNodes.length)
          return
        handleSelectItem(filteredNodes[activeIndex])
        return
      }
      const delta = event.key === 'ArrowDown' ? 1 : -1
      setActiveIndex((prev) => {
        const baseIndex = prev < 0 ? 0 : prev
        const nextIndex = Math.min(Math.max(baseIndex + delta, 0), filteredNodes.length - 1)
        return nextIndex
      })
    }
    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [activeIndex, enableKeyboardNavigation, filteredNodes, handleSelectItem, onClose])

  return (
    <>
      {shouldShowSearchInput && (
        <>
          <div className={cn('mx-2 mb-2 mt-2', searchBoxClassName)}>
            <Input
              showLeftIcon
              showClearIcon
              value={searchText}
              placeholder={t('common.searchAgent', { ns: 'workflow' })}
              onChange={e => setSearchText(e.target.value)}
              onClick={e => e.stopPropagation()}
              onKeyDown={handleKeyDown}
              onClear={() => setSearchText('')}
              onBlur={onBlur}
              autoFocus={autoFocus}
            />
          </div>
          <div
            className="relative left-[-4px] h-[0.5px] bg-black/5"
            style={{ width: 'calc(100% + 8px)' }}
          />
        </>
      )}

      {filteredNodes.length > 0
        ? (
            <div className={cn('max-h-[85vh] overflow-y-auto py-1', maxHeightClass)}>
              {filteredNodes.map((node, index) => (
                <Item
                  key={node.id}
                  node={node}
                  onSelect={onSelect}
                  isHighlighted={enableKeyboardNavigation && index === activeIndex}
                  onSetHighlight={enableKeyboardNavigation ? () => setActiveIndex(index) : undefined}
                  registerRef={enableKeyboardNavigation ? (element) => {
                    itemRefs.current[index] = element
                  } : undefined}
                />
              ))}
            </div>
          )
        : (
            <div className="py-2 pl-3 text-xs font-medium text-text-tertiary">
              {t('common.noAgentNodes', { ns: 'workflow' })}
            </div>
          )}
    </>
  )
}

export default React.memo(AgentNodeList)
