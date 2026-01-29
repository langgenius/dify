'use client'

import type { FileAppearanceType } from '@/app/components/base/file-uploader/types'
import type { SandboxFileTreeNode } from '@/types/sandbox-file'
import * as React from 'react'
import { useCallback, useState } from 'react'
import FileTypeIcon from '@/app/components/base/file-uploader/file-type-icon'
import { cn } from '@/utils/classnames'
import { getFileIconType } from '../utils/file-utils'
import TreeGuideLines from './tree-guide-lines'

const INDENT_SIZE = 20

type ArtifactsTreeProps = {
  data: SandboxFileTreeNode[] | undefined
  onDownload: (node: SandboxFileTreeNode) => void
  onSelect?: (node: SandboxFileTreeNode) => void
  selectedPath?: string
  isDownloading?: boolean
}

type ArtifactsTreeNodeProps = {
  node: SandboxFileTreeNode
  depth: number
  onDownload: (node: SandboxFileTreeNode) => void
  onSelect?: (node: SandboxFileTreeNode) => void
  selectedPath?: string
  isDownloading?: boolean
}

const ArtifactsTreeNode = ({
  node,
  depth,
  onDownload,
  onSelect,
  selectedPath,
  isDownloading,
}: ArtifactsTreeNodeProps) => {
  const [isExpanded, setIsExpanded] = useState(false)
  const isFolder = node.node_type === 'folder'
  const hasChildren = isFolder && node.children.length > 0

  const isSelected = !isFolder && selectedPath === node.path

  const handleClick = useCallback(() => {
    if (isFolder) {
      setIsExpanded(prev => !prev)
    }
    else {
      onSelect?.(node)
    }
  }, [isFolder, node, onSelect])

  const handleDownload = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onDownload(node)
  }, [node, onDownload])

  const fileIconType = !isFolder ? getFileIconType(node.name, node.extension) : null

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        aria-label={isFolder ? `${node.name} folder` : node.name}
        aria-expanded={isFolder ? isExpanded : undefined}
        aria-selected={isSelected}
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ')
            handleClick()
        }}
        className={cn(
          'group relative flex h-6 cursor-pointer items-center rounded-md px-2',
          'hover:bg-state-base-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-components-input-border-active',
          isSelected && 'bg-state-base-hover',
        )}
        style={{ paddingLeft: `${8 + depth * INDENT_SIZE}px` }}
      >
        <TreeGuideLines level={depth} lineOffset={2} />
        <div className="flex size-5 shrink-0 items-center justify-center">
          {isFolder
            ? (
                isExpanded
                  ? <span className="i-ri-folder-open-line size-4 text-text-accent" aria-hidden="true" />
                  : <span className="i-ri-folder-line size-4 text-text-secondary" aria-hidden="true" />
              )
            : <FileTypeIcon type={fileIconType as FileAppearanceType} size="sm" />}
        </div>

        <span className="min-w-0 flex-1 truncate text-[13px] font-normal leading-4 text-text-secondary">
          {node.name}
        </span>

        {!isFolder && (
          <button
            type="button"
            onClick={handleDownload}
            disabled={isDownloading}
            className={cn(
              'flex size-5 shrink-0 items-center justify-center rounded opacity-0 group-hover:opacity-100',
              'hover:bg-state-base-hover-alt',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-components-input-border-active',
              'disabled:cursor-not-allowed disabled:opacity-50',
            )}
            aria-label={`Download ${node.name}`}
          >
            <span className="i-ri-download-line size-3.5 text-text-tertiary" />
          </button>
        )}
      </div>

      {isFolder && isExpanded && hasChildren && (
        <div>
          {node.children.map(child => (
            <ArtifactsTreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              onDownload={onDownload}
              onSelect={onSelect}
              selectedPath={selectedPath}
              isDownloading={isDownloading}
            />
          ))}
        </div>
      )}
    </div>
  )
}

const ArtifactsTree = ({
  data,
  onDownload,
  onSelect,
  selectedPath,
  isDownloading,
}: ArtifactsTreeProps) => {
  if (!data || data.length === 0)
    return null

  return (
    <div className="py-0.5">
      {data.map(node => (
        <ArtifactsTreeNode
          key={node.id}
          node={node}
          depth={0}
          onDownload={onDownload}
          onSelect={onSelect}
          selectedPath={selectedPath}
          isDownloading={isDownloading}
        />
      ))}
    </div>
  )
}

export default React.memo(ArtifactsTree)
