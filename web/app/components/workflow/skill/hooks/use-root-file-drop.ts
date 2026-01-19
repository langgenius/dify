'use client'

// Root-level file drop handler with drag counter to handle nested DOM events

import { useCallback, useRef } from 'react'
import { isFileDrag } from '../utils/drag-utils'
import { useFileDrop } from './use-file-drop'

type UseRootFileDropReturn = {
  handleRootDragEnter: (e: React.DragEvent) => void
  handleRootDragOver: (e: React.DragEvent) => void
  handleRootDragLeave: (e: React.DragEvent) => void
  handleRootDrop: (e: React.DragEvent) => void
  resetRootDragCounter: () => void
}

export function useRootFileDrop(): UseRootFileDropReturn {
  const { handleDragOver, handleDragLeave, handleDrop } = useFileDrop()
  const dragCounterRef = useRef(0)

  const handleRootDragEnter = useCallback((e: React.DragEvent) => {
    if (!isFileDrag(e))
      return
    dragCounterRef.current += 1
  }, [])

  const handleRootDragOver = useCallback((e: React.DragEvent) => {
    handleDragOver(e, { folderId: null, isFolder: false })
  }, [handleDragOver])

  const handleRootDragLeave = useCallback((e: React.DragEvent) => {
    if (!isFileDrag(e))
      return
    dragCounterRef.current = Math.max(dragCounterRef.current - 1, 0)
    if (dragCounterRef.current === 0)
      handleDragLeave(e)
  }, [handleDragLeave])

  const handleRootDrop = useCallback((e: React.DragEvent) => {
    dragCounterRef.current = 0
    handleDrop(e, null)
  }, [handleDrop])

  const resetRootDragCounter = useCallback(() => {
    dragCounterRef.current = 0
  }, [])

  return {
    handleRootDragEnter,
    handleRootDragOver,
    handleRootDragLeave,
    handleRootDrop,
    resetRootDragCounter,
  }
}
