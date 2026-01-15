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
import FileNodeMenu from './file-node-menu'
import FolderNodeMenu from './folder-node-menu'
import { useSkillEditorStore, useSkillEditorStoreApi } from './store'
import { getFileIconType } from './utils/file-utils'

const TreeNode = ({ node, style, dragHandle }: NodeRendererProps<TreeNodeData>) => {
  const isFolder = node.data.node_type === 'folder'
  const isSelected = node.isSelected
  const isDirty = useSkillEditorStore(s => s.dirtyContents.has(node.data.id))
  const contextMenuNodeId = useSkillEditorStore(s => s.contextMenu?.nodeId)
  const hasContextMenu = contextMenuNodeId === node.data.id
  const storeApi = useSkillEditorStoreApi()

  const [showDropdown, setShowDropdown] = useState(false)

  const fileIconType = !isFolder ? getFileIconType(node.data.name) : null

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    node.handleClick(e)
  }

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!isFolder)
      node.activate()
  }

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    node.toggle()
  }

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    storeApi.getState().setContextMenu({
      top: e.clientY,
      left: e.clientX,
      nodeId: node.data.id,
    })
  }, [node.data.id, storeApi])

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
        hasContextMenu && !isSelected && 'bg-state-base-hover',
      )}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
    >
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
                {isDirty && (
                  <span className="absolute -bottom-px -right-px size-[7px] rounded-full border border-white bg-text-warning-secondary" />
                )}
              </div>
            )}
      </div>

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
          {isFolder
            ? (
                <FolderNodeMenu
                  nodeId={node.data.id}
                  onClose={() => setShowDropdown(false)}
                  node={node}
                />
              )
            : (
                <FileNodeMenu
                  nodeId={node.data.id}
                  onClose={() => setShowDropdown(false)}
                  node={node}
                />
              )}
        </PortalToFollowElemContent>
      </PortalToFollowElem>
    </div>
  )
}

export default React.memo(TreeNode)
