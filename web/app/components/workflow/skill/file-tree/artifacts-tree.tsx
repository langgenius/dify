'use client'

import type { FC } from 'react'
import type { SandboxFileTreeNode } from '@/types/sandbox-file'
import { RiDownloadLine, RiFile3Fill, RiFolderLine } from '@remixicon/react'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { cn } from '@/utils/classnames'

type ArtifactsTreeProps = {
  data: SandboxFileTreeNode[] | undefined
  onDownload: (node: SandboxFileTreeNode) => void
  isDownloading?: boolean
}

type ArtifactsTreeNodeProps = {
  node: SandboxFileTreeNode
  depth: number
  onDownload: (node: SandboxFileTreeNode) => void
  isDownloading?: boolean
}

const ArtifactsTreeNode: FC<ArtifactsTreeNodeProps> = ({
  node,
  depth,
  onDownload,
  isDownloading,
}) => {
  const [isExpanded, setIsExpanded] = useState(false)
  const isFolder = node.node_type === 'folder'
  const hasChildren = isFolder && node.children.length > 0

  const handleToggle = useCallback(() => {
    if (isFolder)
      setIsExpanded(prev => !prev)
  }, [isFolder])

  const handleDownload = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onDownload(node)
  }, [node, onDownload])

  return (
    <div>
      <div
        role={isFolder ? 'button' : undefined}
        tabIndex={isFolder ? 0 : undefined}
        onClick={handleToggle}
        onKeyDown={isFolder
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ')
                handleToggle()
            }
          : undefined}
        className={cn(
          'group flex items-center gap-0 rounded-md py-0.5 pr-1.5',
          isFolder && 'cursor-pointer hover:bg-state-base-hover',
          !isFolder && 'hover:bg-state-base-hover',
        )}
        style={{ paddingLeft: `${8 + depth * 20}px` }}
      >
        <div className="flex size-5 shrink-0 items-center justify-center">
          {isFolder
            ? <RiFolderLine className="size-4 text-text-tertiary" />
            : <RiFile3Fill className="size-4 text-text-quaternary" />}
        </div>

        <span className="system-sm-regular flex-1 truncate px-1 py-0.5 text-text-secondary">
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
            <RiDownloadLine className="size-3.5 text-text-tertiary" />
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
              isDownloading={isDownloading}
            />
          ))}
        </div>
      )}
    </div>
  )
}

const ArtifactsTree: FC<ArtifactsTreeProps> = ({
  data,
  onDownload,
  isDownloading,
}) => {
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
          isDownloading={isDownloading}
        />
      ))}
    </div>
  )
}

export default React.memo(ArtifactsTree)
