'use client'

import type { FC } from 'react'
import type { FileAppearanceType } from '@/app/components/base/file-uploader/types'
import type { SandboxFileTreeNode } from '@/types/sandbox-file'
import { RiDownloadLine, RiFolderLine, RiFolderOpenLine } from '@remixicon/react'
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

  const fileIconType = !isFolder ? getFileIconType(node.name) : null

  return (
    <div>
      <div
        role={isFolder ? 'button' : undefined}
        tabIndex={isFolder ? 0 : undefined}
        aria-label={isFolder ? `${node.name} folder` : undefined}
        aria-expanded={isFolder ? isExpanded : undefined}
        onClick={handleToggle}
        onKeyDown={isFolder
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ')
                handleToggle()
            }
          : undefined}
        className={cn(
          'group relative flex h-6 items-center rounded-md px-2',
          isFolder && 'cursor-pointer hover:bg-state-base-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-components-input-border-active',
          !isFolder && 'hover:bg-state-base-hover',
        )}
        style={{ paddingLeft: `${8 + depth * INDENT_SIZE}px` }}
      >
        <TreeGuideLines level={depth} />
        <div className="flex size-5 shrink-0 items-center justify-center">
          {isFolder
            ? (
                isExpanded
                  ? <RiFolderOpenLine className="size-4 text-text-accent" aria-hidden="true" />
                  : <RiFolderLine className="size-4 text-text-secondary" aria-hidden="true" />
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
