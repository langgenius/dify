'use client'

// Unified drag handler that routes to file upload or node move based on drag type

import type { AppAssetTreeView } from '@/types/app-asset'
import { useCallback } from 'react'
import { getDragActionType, isFileDrag, isNodeDrag } from '../utils/drag-utils'
import { useFileDrop } from './use-file-drop'
import { useNodeMove } from './use-node-move'

type DragTarget = {
  folderId: string | null
  isFolder: boolean
}

type UseUnifiedDragOptions = {
  treeChildren: AppAssetTreeView[]
}

export function useUnifiedDrag({ treeChildren }: UseUnifiedDragOptions) {
  const fileDrop = useFileDrop()
  const nodeMove = useNodeMove({ treeChildren })

  const handleDragOver = useCallback((e: React.DragEvent, target: DragTarget) => {
    const actionType = getDragActionType(e)
    if (actionType === 'upload') {
      fileDrop.handleDragOver(e, target)
    }
    else if (actionType === 'move') {
      nodeMove.handleDragOver(e, target)
    }
  }, [fileDrop, nodeMove])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (isFileDrag(e)) {
      fileDrop.handleDragLeave(e)
    }
    else if (isNodeDrag(e)) {
      nodeMove.handleDragLeave(e)
    }
  }, [fileDrop, nodeMove])

  const handleDrop = useCallback((e: React.DragEvent, targetFolderId: string | null) => {
    if (isFileDrag(e)) {
      return fileDrop.handleDrop(e, targetFolderId)
    }
    else if (isNodeDrag(e)) {
      return nodeMove.handleDrop(e, targetFolderId)
    }
  }, [fileDrop, nodeMove])

  return {
    handleDragOver,
    handleDragLeave,
    handleDrop,
    // Expose individual handlers for specific needs
    handleNodeDragStart: nodeMove.handleDragStart,
    handleNodeDragEnd: nodeMove.handleDragEnd,
    isUploading: fileDrop.isUploading,
    isMoving: nodeMove.isMoving,
  }
}
