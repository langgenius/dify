'use client'

import type { TreeApi } from 'react-arborist'
import type { TreeNodeData } from '../../../type'
import { useEffect } from 'react'
import { isArtifactTab, START_TAB_ID } from '@/app/components/workflow/skill/constants'
import { useWorkflowStore } from '@/app/components/workflow/store'

type UseSyncTreeWithActiveTabOptions = {
  treeRef: React.RefObject<TreeApi<TreeNodeData> | null>
  activeTabId: string | null
  syncSignal?: number
  isTreeLoading?: boolean
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
  syncSignal,
  isTreeLoading,
}: UseSyncTreeWithActiveTabOptions): void {
  const storeApi = useWorkflowStore()

  useEffect(() => {
    if (!activeTabId || isTreeLoading)
      return

    const frame = requestAnimationFrame(() => {
      const tree = treeRef.current
      if (!tree)
        return

      if (activeTabId === START_TAB_ID || isArtifactTab(activeTabId)) {
        if (tree.selectedNodes.length > 0)
          tree.deselectAll()
        return
      }

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

      let hasClosedAncestor = false
      current = node.parent
      while (current && !current.isRoot) {
        if (!current.isOpen) {
          hasClosedAncestor = true
          break
        }
        current = current.parent
      }
      if (hasClosedAncestor)
        tree.openParents(node)

      if (!node.isSelected)
        tree.select(activeTabId)
    })

    return () => cancelAnimationFrame(frame)
  }, [activeTabId, isTreeLoading, storeApi, syncSignal, treeRef])
}
