'use client'

import type { AppAssetTreeView } from '@/types/app-asset'
import { useCallback, useMemo } from 'react'
import { useStore, useWorkflowStore } from '@/app/components/workflow/store'
import { cn } from '@/utils/classnames'
import { flattenMatchingNodes, getAncestorIds } from '../utils/tree-utils'
import { TreeNodeIcon } from './tree-node-icon'

type SearchResultListProps = {
  searchTerm: string
  treeChildren: AppAssetTreeView[]
}

const SearchResultList = ({ searchTerm, treeChildren }: SearchResultListProps) => {
  const activeTabId = useStore(s => s.activeTabId)
  const storeApi = useWorkflowStore()

  const results = useMemo(
    () => flattenMatchingNodes(treeChildren, searchTerm),
    [treeChildren, searchTerm],
  )

  const handleClick = useCallback((node: AppAssetTreeView) => {
    if (node.node_type === 'file') {
      storeApi.getState().openTab(node.id, { pinned: true })
    }
    else {
      const ancestors = getAncestorIds(node.id, treeChildren)
      storeApi.getState().revealFile([...ancestors, node.id])
      storeApi.getState().setFileTreeSearchTerm('')
    }
  }, [storeApi, treeChildren])

  return (
    <div className="flex flex-col gap-px p-1">
      {results.map(({ node, parentPath }) => (
        <div
          key={node.id}
          role="button"
          tabIndex={0}
          className={cn(
            'flex h-6 w-full cursor-pointer items-center rounded-md px-2',
            'hover:bg-state-base-hover',
            activeTabId === node.id && 'bg-state-base-active',
          )}
          onClick={() => handleClick(node)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              handleClick(node)
            }
          }}
        >
          <div className="flex min-w-0 flex-1 items-center">
            <div className="flex size-5 shrink-0 items-center justify-center">
              <TreeNodeIcon
                isFolder={node.node_type === 'folder'}
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
      ))}
    </div>
  )
}

export default SearchResultList
