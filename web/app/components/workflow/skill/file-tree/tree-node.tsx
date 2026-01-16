'use client'

import type { NodeRendererProps } from 'react-arborist'
import type { TreeNodeData } from '../type'
import type { FileAppearanceType } from '@/app/components/base/file-uploader/types'
import { RiFolderLine, RiFolderOpenLine, RiMoreFill } from '@remixicon/react'
import { throttle } from 'es-toolkit/function'
import * as React from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import FileTypeIcon from '@/app/components/base/file-uploader/file-type-icon'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { useStore, useWorkflowStore } from '@/app/components/workflow/store'
import { cn } from '@/utils/classnames'
import { useDelayedClick } from '../hooks/use-delayed-click'
import { getFileIconType } from '../utils/file-utils'
import NodeMenu from './node-menu'
import TreeEditInput from './tree-edit-input'
import TreeGuideLines from './tree-guide-lines'

const TreeNode = ({ node, style, dragHandle }: NodeRendererProps<TreeNodeData>) => {
  const { t } = useTranslation('workflow')
  const isFolder = node.data.node_type === 'folder'
  const isSelected = node.isSelected
  const isDirty = useStore(s => s.dirtyContents?.has(node.data.id) ?? false)
  const contextMenuNodeId = useStore(s => s.contextMenu?.nodeId)
  const hasContextMenu = contextMenuNodeId === node.data.id
  const storeApi = useWorkflowStore()

  const [showDropdown, setShowDropdown] = useState(false)

  const fileIconType = !isFolder ? getFileIconType(node.data.name) : null

  const throttledToggle = useMemo(
    () => throttle(() => node.toggle(), 300, { edges: ['leading'] }),
    [node],
  )

  const openFilePreview = useCallback(() => {
    storeApi.getState().openTab?.(node.data.id, { pinned: false })
  }, [node.data.id, storeApi])

  const openFilePinned = useCallback(() => {
    storeApi.getState().openTab?.(node.data.id, { pinned: true })
  }, [node.data.id, storeApi])

  const { handleClick: handleFileClick, handleDoubleClick: handleFileDoubleClick } = useDelayedClick({
    onSingleClick: openFilePreview,
    onDoubleClick: openFilePinned,
  })

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    node.select()
    if (isFolder)
      throttledToggle()
    else
      handleFileClick()
  }

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isFolder)
      throttledToggle()
    else
      handleFileDoubleClick()
  }

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    throttledToggle()
  }

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    storeApi.getState().setContextMenu?.({
      top: e.clientY,
      left: e.clientX,
      nodeId: node.data.id,
    })
  }, [node.data.id, storeApi])

  const handleMoreClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setShowDropdown(prev => !prev)
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (isFolder)
        node.toggle()
      else
        storeApi.getState().openTab?.(node.data.id, { pinned: true })
    }
  }, [isFolder, node, storeApi])

  return (
    <div
      ref={dragHandle}
      style={style}
      role="treeitem"
      tabIndex={0}
      aria-selected={isSelected}
      aria-expanded={isFolder ? node.isOpen : undefined}
      className={cn(
        'group relative flex h-6 cursor-pointer items-center gap-2 rounded-md px-2',
        'hover:bg-state-base-hover',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-components-input-border-active',
        isSelected && 'bg-state-base-active',
        hasContextMenu && !isSelected && 'bg-state-base-hover',
      )}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      onContextMenu={handleContextMenu}
    >
      <TreeGuideLines level={node.level} />
      <div className="flex size-5 shrink-0 items-center justify-center">
        {isFolder
          ? (
              <button
                type="button"
                tabIndex={-1}
                onClick={handleToggle}
                aria-label={t('skillSidebar.toggleFolder')}
                className={cn(
                  'flex size-full items-center justify-center rounded',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-components-input-border-active',
                )}
              >
                {node.isOpen
                  ? <RiFolderOpenLine className="size-4 text-text-accent" aria-hidden="true" />
                  : <RiFolderLine className="size-4 text-text-secondary" aria-hidden="true" />}
              </button>
            )
          : (
              <div className="relative flex size-full items-center justify-center">
                <FileTypeIcon type={fileIconType as FileAppearanceType} size="sm" />
                {isDirty && (
                  <span className="absolute -bottom-px -right-px size-[7px] rounded-full border border-white bg-text-warning-secondary" />
                )}
              </div>
            )}
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
