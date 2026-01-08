'use client'
import type { FC } from 'react'
import type { BlockEnum } from '@/app/components/workflow/types'
import * as React from 'react'
import { useState } from 'react'
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
}

const Item: FC<ItemProps> = ({ node, onSelect }) => {
  const [isHovering, setIsHovering] = useState(false)

  return (
    <button
      type="button"
      className={cn(
        'relative flex h-6 w-full cursor-pointer items-center rounded-md border-none bg-transparent px-3 text-left',
        isHovering && 'bg-state-base-hover',
      )}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
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
}) => {
  const { t } = useTranslation()
  const [searchText, setSearchText] = useState('')

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose?.()
    }
  }

  const filteredNodes = nodes.filter((node) => {
    if (!searchText)
      return true
    return node.title.toLowerCase().includes(searchText.toLowerCase())
  })

  return (
    <>
      {!hideSearch && (
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
              {filteredNodes.map(node => (
                <Item
                  key={node.id}
                  node={node}
                  onSelect={onSelect}
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
