'use client'

import type { NodeRendererProps } from 'react-arborist'
import type { TreeNodeData } from './type'
import type { FileAppearanceType } from '@/app/components/base/file-uploader/types'
import { RiFolderLine, RiFolderOpenLine } from '@remixicon/react'
import * as React from 'react'
import FileTypeIcon from '@/app/components/base/file-uploader/file-type-icon'
import { cn } from '@/utils/classnames'
import { useSkillEditorStore } from './store'
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
 */
const FileTreeNode = ({ node, style, dragHandle }: NodeRendererProps<TreeNodeData>) => {
  const isFolder = node.data.node_type === 'folder'
  const isSelected = node.isSelected
  const isDirty = useSkillEditorStore(s => s.dirtyContents.has(node.data.id))

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
    </div>
  )
}

export default React.memo(FileTreeNode)
