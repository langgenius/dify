'use client'

import type { NodeApi } from 'react-arborist'
import type { TreeNodeData } from '../type'
import { throttle } from 'es-toolkit/function'
import { useCallback, useMemo } from 'react'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { useDelayedClick } from './use-delayed-click'

type UseTreeNodeHandlersOptions = {
  node: NodeApi<TreeNodeData>
}

type UseTreeNodeHandlersReturn = {
  handleClick: (e: React.MouseEvent) => void
  handleDoubleClick: (e: React.MouseEvent) => void
  handleToggle: (e: React.MouseEvent) => void
  handleContextMenu: (e: React.MouseEvent) => void
  handleKeyDown: (e: React.KeyboardEvent) => void
}

/**
 * Hook that encapsulates all tree node interaction handlers.
 * Handles click, double-click, toggle, context menu, and keyboard events.
 */
export function useTreeNodeHandlers({
  node,
}: UseTreeNodeHandlersOptions): UseTreeNodeHandlersReturn {
  const storeApi = useWorkflowStore()
  const isFolder = node.data.node_type === 'folder'

  const throttledToggle = useMemo(
    () => throttle(() => node.toggle(), 300, { edges: ['leading'] }),
    [node],
  )

  const openFilePreview = useCallback(() => {
    storeApi.getState().openTab(node.data.id, { pinned: false })
  }, [node.data.id, storeApi])

  const openFilePinned = useCallback(() => {
    storeApi.getState().openTab(node.data.id, { pinned: true })
  }, [node.data.id, storeApi])

  const { handleClick: handleFileClick, handleDoubleClick: handleFileDoubleClick } = useDelayedClick({
    onSingleClick: openFilePreview,
    onDoubleClick: openFilePinned,
  })

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    storeApi.getState().setCreateTargetNodeId(node.data.id)
    node.select()
    if (isFolder)
      throttledToggle()
    else
      handleFileClick()
  }, [handleFileClick, isFolder, node, storeApi, throttledToggle])

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (isFolder)
      throttledToggle()
    else
      handleFileDoubleClick()
  }, [isFolder, throttledToggle, handleFileDoubleClick])

  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    throttledToggle()
  }, [throttledToggle])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    storeApi.getState().setCreateTargetNodeId(node.data.id)
    storeApi.getState().setContextMenu({
      top: e.clientY,
      left: e.clientX,
      type: 'node',
      nodeId: node.data.id,
    })
  }, [node.data.id, storeApi])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (isFolder)
        node.toggle()
      else
        storeApi.getState().openTab(node.data.id, { pinned: true })
    }
  }, [isFolder, node, storeApi])

  return {
    handleClick,
    handleDoubleClick,
    handleToggle,
    handleContextMenu,
    handleKeyDown,
  }
}
