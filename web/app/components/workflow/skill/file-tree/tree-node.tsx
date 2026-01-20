'use client'

import type { NodeRendererProps } from 'react-arborist'
import type { TreeNodeData } from '../type'
import { RiMoreFill } from '@remixicon/react'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { useStore } from '@/app/components/workflow/store'
import { cn } from '@/utils/classnames'
import { useFolderFileDrop } from '../hooks/use-folder-file-drop'
import { useTreeNodeHandlers } from '../hooks/use-tree-node-handlers'
import NodeMenu from './node-menu'
import TreeEditInput from './tree-edit-input'
import TreeGuideLines from './tree-guide-lines'
import { TreeNodeIcon } from './tree-node-icon'

const TreeNode = ({ node, style, dragHandle }: NodeRendererProps<TreeNodeData>) => {
  const { t } = useTranslation('workflow')
  const isFolder = node.data.node_type === 'folder'
  const isSelected = node.isSelected
  const isDirty = useStore(s => s.dirtyContents.has(node.data.id))
  const isCut = useStore(s => s.isCutNode(node.data.id))
  const contextMenuNodeId = useStore(s => s.contextMenu?.nodeId)
  const hasContextMenu = contextMenuNodeId === node.data.id

  const [showDropdown, setShowDropdown] = useState(false)

  const {
    handleClick,
    handleDoubleClick,
    handleToggle,
    handleContextMenu,
    handleKeyDown,
  } = useTreeNodeHandlers({ node })

  const { isDragOver, isBlinking, dragHandlers } = useFolderFileDrop(node)

  const handleMoreClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setShowDropdown(prev => !prev)
  }, [])

  return (
    <div
      ref={dragHandle}
      style={style}
      role="treeitem"
      tabIndex={0}
      aria-selected={isSelected}
      aria-expanded={isFolder ? node.isOpen : undefined}
      className={cn(
        'group relative flex h-6 cursor-pointer items-center rounded-md px-2',
        'hover:bg-state-base-hover',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-components-input-border-active',
        isSelected && 'bg-state-base-active',
        hasContextMenu && !isSelected && 'bg-state-base-hover',
        isDragOver && 'bg-state-accent-hover ring-1 ring-inset ring-state-accent-solid',
        isBlinking && 'animate-drag-blink',
        isCut && 'opacity-50',
      )}
      onKeyDown={handleKeyDown}
      onContextMenu={handleContextMenu}
      {...(isFolder && {
        onDragEnter: dragHandlers.onDragEnter,
        onDragOver: dragHandlers.onDragOver,
        onDrop: dragHandlers.onDrop,
        onDragLeave: dragHandlers.onDragLeave,
      })}
    >
      <TreeGuideLines level={node.level} />
      {/* Main content area - isolated click/double-click handling */}
      <div
        className="flex min-w-0 flex-1 items-center gap-2"
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      >
        <div className="flex size-5 shrink-0 items-center justify-center">
          <TreeNodeIcon
            isFolder={isFolder}
            isOpen={node.isOpen}
            fileName={node.data.name}
            isDirty={isDirty}
            onToggle={handleToggle}
          />
        </div>

        {node.isEditing
          ? (
              <TreeEditInput node={node} />
            )
          : (
              <span
                className={cn(
                  'min-w-0 flex-1 truncate text-[13px] font-normal leading-4',
                  isSelected
                    ? 'text-text-primary'
                    : 'text-text-secondary',
                )}
              >
                {node.data.name}
              </span>
            )}
      </div>

      {/* More button - separate from main content click handling */}
      <PortalToFollowElem
        placement="bottom-start"
        offset={4}
        open={showDropdown}
        onOpenChange={setShowDropdown}
      >
        <PortalToFollowElemTrigger asChild>
          <button
            type="button"
            tabIndex={-1}
            onClick={handleMoreClick}
            className={cn(
              'flex size-5 shrink-0 items-center justify-center rounded',
              'hover:bg-state-base-hover-alt',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-components-input-border-active',
              'invisible focus-visible:visible group-hover:visible',
              showDropdown && 'visible',
            )}
            aria-label={t('skillSidebar.menu.moreActions')}
          >
            <RiMoreFill className="size-4 text-text-tertiary" aria-hidden="true" />
          </button>
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className="z-[100]">
          <NodeMenu
            type={isFolder ? 'folder' : 'file'}
            onClose={() => setShowDropdown(false)}
            node={node}
          />
        </PortalToFollowElemContent>
      </PortalToFollowElem>
    </div>
  )
}

export default React.memo(TreeNode)
