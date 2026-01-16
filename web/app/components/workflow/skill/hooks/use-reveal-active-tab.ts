'use client'

import type { TreeApi } from 'react-arborist'
import type { TreeNodeData } from '../type'
import type { AppAssetTreeView } from '@/types/app-asset'
import { useEffect } from 'react'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { getAncestorIds } from '../utils/tree-utils'

type UseRevealActiveTabOptions = {
  treeRef: React.RefObject<TreeApi<TreeNodeData> | null>
  activeTabId: string | null
  treeChildren: AppAssetTreeView[] | undefined
}

/**
 * Hook that handles revealing the active tab in the file tree.
 * Expands ancestor folders and scrolls to the active node.
 */
export function useRevealActiveTab({
  treeRef,
  activeTabId,
  treeChildren,
}: UseRevealActiveTabOptions): void {
  const storeApi = useWorkflowStore()

  useEffect(() => {
    if (!activeTabId || !treeChildren)
      return

    const tree = treeRef.current
    if (!tree)
      return

    const ancestors = getAncestorIds(activeTabId, treeChildren)
    if (ancestors.length > 0)
      storeApi.getState().revealFile(ancestors)

    requestAnimationFrame(() => {
      const node = tree.get(activeTabId)
      if (node) {
        tree.openParents(node)
        tree.scrollTo(activeTabId)
      }
    })
  }, [activeTabId, treeChildren, storeApi, treeRef])
}
