'use client'

// Unified drag handler for external file uploads
// Internal node drag-move is now handled by react-arborist's built-in drag system

import { useCallback } from 'react'
import { isFileDrag } from '../../../utils/drag-utils'
import { useFileDrop } from './use-file-drop'

type DragTarget = {
  folderId: string | null
  isFolder: boolean
}

export function useUnifiedDrag() {
  const fileDrop = useFileDrop()

  // Only handle external file drags - internal node drags are handled by react-arborist
  const handleDragOver = useCallback((e: React.DragEvent, target: DragTarget) => {
    if (isFileDrag(e))
      fileDrop.handleDragOver(e, target)
  }, [fileDrop])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (isFileDrag(e))
      fileDrop.handleDragLeave(e)
  }, [fileDrop])

  const handleDrop = useCallback((e: React.DragEvent, targetFolderId: string | null) => {
    if (isFileDrag(e))
      return fileDrop.handleDrop(e, targetFolderId)
  }, [fileDrop])

  return {
    handleDragOver,
    handleDragLeave,
    handleDrop,
    isUploading: fileDrop.isUploading,
  }
}
