'use client'

import type { TreeApi } from 'react-arborist'
import type { TreeNodeData } from '../type'
import { useEffect } from 'react'
import { isArtifactTab, START_TAB_ID } from '@/app/components/workflow/skill/constants'
import { useWorkflowStore } from '@/app/components/workflow/store'

type UseSyncTreeWithActiveTabOptions = {
  treeRef: React.RefObject<TreeApi<TreeNodeData> | null>
  activeTabId: string | null
}

/**
 * Hook that synchronizes the file tree with the active tab.
 * Expands ancestor folders and scrolls to the active node.
 *
 * Uses node.parent chain for efficient ancestor traversal instead of
 * re-traversing the tree data structure.
 */
export function useSyncTreeWithActiveTab({
  treeRef,
  activeTabId,
}: UseSyncTreeWithActiveTabOptions): void {
  const storeApi = useWorkflowStore()

  useEffect(() => {
    if (!activeTabId || activeTabId === START_TAB_ID)
      return

    const tree = treeRef.current
    if (!tree)
      return

    if (isArtifactTab(activeTabId)) {
      requestAnimationFrame(() => {
        tree.deselectAll()
      })
      return
    }

    requestAnimationFrame(() => {
      const node = tree.get(activeTabId)
      if (!node)
        return

      const ancestors: string[] = []
      let current = node.parent
      while (current && !current.isRoot) {
        ancestors.push(current.id)
        current = current.parent
      }

      if (ancestors.length > 0)
        storeApi.getState().revealFile(ancestors)

      tree.openParents(node)
      tree.select(activeTabId)
      tree.scrollTo(activeTabId)
    })
  }, [activeTabId, treeRef, storeApi])
}
