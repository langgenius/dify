'use client'

import type { NodeRendererProps } from 'react-arborist'
import type { TreeNodeData } from './type'
import type { FileAppearanceType } from '@/app/components/base/file-uploader/types'
import { RiFolderLine, RiFolderOpenLine, RiMoreFill } from '@remixicon/react'
import * as React from 'react'
import { useCallback, useState } from 'react'
import FileTypeIcon from '@/app/components/base/file-uploader/file-type-icon'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { cn } from '@/utils/classnames'
import FileOperationsMenu from './file-operations-menu'
import { useSkillEditorStore, useSkillEditorStoreApi } from './store'
import { getFileIconType } from './utils'

/**
 * FileTreeNode - Custom node renderer for react-arborist
 *
 * Matches Figma design specifications:
 * - Row height: 24px
 * - Icon size: 16x16 in 20x20 container
 * - Font: 13px Inter, regular (400) / medium (500) for selected
 * - Colors: text-secondary (#354052), text-primary (#101828) for selected
 * - Hover bg: rgba(200,206,218,0.2), Active bg: rgba(200,206,218,0.4)
 * - Folder icon: blue (#155aef) when open
 *
 * Features:
 * - Right-click context menu for folders
 * - "..." button dropdown for folders (visible on hover)
 */
const FileTreeNode = ({ node, style, dragHandle }: NodeRendererProps<TreeNodeData>) => {
  const isFolder = node.data.node_type === 'folder'
  const isSelected = node.isSelected
  const isDirty = useSkillEditorStore(s => s.dirtyContents.has(node.data.id))
  const storeApi = useSkillEditorStoreApi()

  // Dropdown menu state (for ... button)
  const [showDropdown, setShowDropdown] = useState(false)

  // Get file icon type for files
  const fileIconType = !isFolder ? getFileIconType(node.data.name) : null

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    node.handleClick(e)
  }

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    // For files, activate (open in editor)
    if (!isFolder)
      node.activate()
  }

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    node.toggle()
  }

  // Right-click context menu handler (folders only)
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    // Only show context menu for folders
    if (!isFolder)
      return

    e.preventDefault()
    e.stopPropagation()

    storeApi.getState().setContextMenu({
      top: e.clientY,
      left: e.clientX,
      nodeId: node.data.id,
    })
  }, [isFolder, node.data.id, storeApi])

  // More button click handler
  const handleMoreClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setShowDropdown(prev => !prev)
  }, [])

  return (
    <div
      ref={dragHandle}
      style={style}
      className={cn(
        'group flex h-6 cursor-pointer items-center gap-2 rounded-md px-2',
        'hover:bg-state-base-hover',
        isSelected && 'bg-state-base-active',
      )}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
    >
      {/* Icon */}
      <div className="flex size-5 shrink-0 items-center justify-center">
        {isFolder
          ? (
              <button
                type="button"
                onClick={handleToggle}
                className="flex size-full items-center justify-center"
              >
                {node.isOpen
                  ? <RiFolderOpenLine className="size-4 text-text-accent" />
                  : <RiFolderLine className="size-4 text-text-secondary" />}
              </button>
            )
          : (
              <div className="relative flex size-full items-center justify-center">
                <FileTypeIcon type={fileIconType as FileAppearanceType} size="sm" />
                {/* Dirty indicator dot */}
                {isDirty && (
                  <span className="absolute -bottom-px -right-px size-[7px] rounded-full border border-white bg-text-warning-secondary" />
                )}
              </div>
            )}
      </div>

      {/* Name */}
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-[13px] leading-4',
          isSelected
            ? 'font-medium text-text-primary'
            : 'text-text-secondary',
        )}
      >
        {node.data.name}
      </span>

      {/* More button - only for folders, visible on hover */}
      {isFolder && (
        <PortalToFollowElem
          placement="bottom-start"
          offset={4}
          open={showDropdown}
          onOpenChange={setShowDropdown}
        >
          <PortalToFollowElemTrigger asChild>
            <button
              type="button"
              onClick={handleMoreClick}
              className={cn(
                'flex size-5 shrink-0 items-center justify-center rounded',
                'hover:bg-state-base-hover-alt',
                'invisible group-hover:visible',
                showDropdown && 'visible',
              )}
              aria-label="File operations"
            >
              <RiMoreFill className="size-4 text-text-tertiary" />
            </button>
          </PortalToFollowElemTrigger>
          <PortalToFollowElemContent className="z-[100]">
            <FileOperationsMenu
              nodeId={node.data.id}
              onClose={() => setShowDropdown(false)}
            />
          </PortalToFollowElemContent>
        </PortalToFollowElem>
      )}
    </div>
  )
}

export default React.memo(FileTreeNode)
