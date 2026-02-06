'use client'

import type { AppAssetTreeView } from '@/types/app-asset'
import { useCallback, useMemo } from 'react'
import { useStore, useWorkflowStore } from '@/app/components/workflow/store'
import { cn } from '@/utils/classnames'
import { useDelayedClick } from '../hooks/use-delayed-click'
import { flattenMatchingNodes, getAncestorIds } from '../utils/tree-utils'
import { TreeNodeIcon } from './tree-node-icon'

type SearchResultListProps = {
  searchTerm: string
  treeChildren: AppAssetTreeView[]
}

type SearchResultRowProps = {
  node: AppAssetTreeView
  parentPath: string
  treeChildren: AppAssetTreeView[]
}

const SearchResultRow = ({ node, parentPath, treeChildren }: SearchResultRowProps) => {
  const isActive = useStore(s => s.activeTabId === node.id)
  const storeApi = useWorkflowStore()
  const isFile = node.node_type === 'file'

  const openFilePreview = useCallback(() => {
    storeApi.getState().clearArtifactSelection()
    storeApi.getState().openTab(node.id, { pinned: false })
  }, [node.id, storeApi])

  const openFilePinned = useCallback(() => {
    storeApi.getState().clearArtifactSelection()
    storeApi.getState().openTab(node.id, { pinned: true })
  }, [node.id, storeApi])

  const { handleClick: handleFileClick, handleDoubleClick: handleFileDoubleClick } = useDelayedClick({
    onSingleClick: openFilePreview,
    onDoubleClick: openFilePinned,
  })

  const handleFolderClick = useCallback(() => {
    const ancestors = getAncestorIds(node.id, treeChildren)
    storeApi.getState().revealFile([...ancestors, node.id])
    storeApi.getState().setFileTreeSearchTerm('')
  }, [node.id, storeApi, treeChildren])

  const handleClick = isFile ? handleFileClick : handleFolderClick
  const handleDoubleClick = isFile ? handleFileDoubleClick : undefined

  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        'flex h-6 w-full cursor-pointer items-center rounded-md px-2',
        'hover:bg-state-base-hover',
        isActive && 'bg-state-base-active',
      )}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          if (isFile)
            openFilePinned()
          else
            handleFolderClick()
        }
      }}
    >
      <div className="flex min-w-0 flex-1 items-center">
        <div className="flex size-5 shrink-0 items-center justify-center">
          <TreeNodeIcon
            isFolder={!isFile}
            isOpen={false}
            fileName={node.name}
            extension={node.extension}
            isDirty={false}
          />
        </div>
        <span className="min-w-0 truncate px-1 py-0.5 text-[13px] font-normal leading-4 text-text-secondary">
          {node.name}
        </span>
      </div>
      {parentPath && (
        <span className="system-xs-regular shrink-0 text-text-tertiary">
          {parentPath}
        </span>
      )}
    </div>
  )
}

const SearchResultList = ({ searchTerm, treeChildren }: SearchResultListProps) => {
  const results = useMemo(
    () => flattenMatchingNodes(treeChildren, searchTerm),
    [treeChildren, searchTerm],
  )

  return (
    <div className="flex flex-col gap-px p-1">
      {results.map(({ node, parentPath }) => (
        <SearchResultRow
          key={node.id}
          node={node}
          parentPath={parentPath}
          treeChildren={treeChildren}
        />
      ))}
    </div>
  )
}

export default SearchResultList
