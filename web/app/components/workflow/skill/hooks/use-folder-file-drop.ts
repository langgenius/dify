'use client'

// Folder node drop handler with VSCode-style blink animation and auto-expand
// Works for both external file uploads and internal node drag-and-drop
// Auto-expand is triggered by Zustand isDragOver state (single source of truth)

import type { NodeApi } from 'react-arborist'
import type { TreeNodeData } from '../type'
import type { AppAssetTreeView } from '@/types/app-asset'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '@/app/components/workflow/store'
import { isDragEvent } from '../utils/drag-utils'
import { useUnifiedDrag } from './use-unified-drag'

type UseFolderFileDropReturn = {
  isDragOver: boolean
  isBlinking: boolean
  dragHandlers: {
    onDragEnter: (e: React.DragEvent) => void
    onDragOver: (e: React.DragEvent) => void
    onDragLeave: (e: React.DragEvent) => void
    onDrop: (e: React.DragEvent) => void
  }
}

// Blink starts at 1s, folder expands at 2s
const BLINK_START_DELAY_MS = 1000
const AUTO_EXPAND_DELAY_MS = 2000

type UseFolderFileDropOptions = {
  node: NodeApi<TreeNodeData>
  treeChildren: AppAssetTreeView[]
}

export function useFolderFileDrop({ node, treeChildren: _treeChildren }: UseFolderFileDropOptions): UseFolderFileDropReturn {
  const isFolder = node.data.node_type === 'folder'
  const dragOverFolderId = useStore(s => s.dragOverFolderId)
  const isDragOver = isFolder && dragOverFolderId === node.data.id

  const { handleDragOver, handleDrop } = useUnifiedDrag()

  const dragCounterRef = useRef(0)
  const [isBlinking, setIsBlinking] = useState(false)

  // Auto-expand logic triggered by isDragOver state change (single source of truth)
  // Works for both external file drag and internal node drag
  useEffect(() => {
    if (!isDragOver || node.isOpen)
      return

    // Start blinking after 1 second
    const blinkTimer = setTimeout(() => {
      setIsBlinking(true)
    }, BLINK_START_DELAY_MS)

    // Expand folder after 2 seconds
    const expandTimer = setTimeout(() => {
      setIsBlinking(false)
      if (!node.isOpen)
        node.open()
    }, AUTO_EXPAND_DELAY_MS)

    return () => {
      clearTimeout(blinkTimer)
      clearTimeout(expandTimer)
      setIsBlinking(false)
    }
  }, [isDragOver, node.isOpen, node])

  // dragEnter only used for drag counter (handles nested DOM events)
  const handleFolderDragEnter = useCallback((e: React.DragEvent) => {
    if (!isFolder || !isDragEvent(e))
      return
    dragCounterRef.current += 1
  }, [isFolder])

  const handleFolderDragOver = useCallback((e: React.DragEvent) => {
    if (!isFolder || !isDragEvent(e))
      return
    handleDragOver(e, { folderId: node.data.id, isFolder: true })
  }, [handleDragOver, isFolder, node.data.id])

  const handleFolderDragLeave = useCallback((e: React.DragEvent) => {
    if (!isFolder || !isDragEvent(e))
      return
    dragCounterRef.current = Math.max(dragCounterRef.current - 1, 0)
  }, [isFolder])

  const handleFolderDrop = useCallback((e: React.DragEvent) => {
    if (!isFolder)
      return
    dragCounterRef.current = 0
    handleDrop(e, node.data.id)
  }, [handleDrop, isFolder, node.data.id])

  const dragHandlers = useMemo(() => {
    return {
      onDragEnter: handleFolderDragEnter,
      onDragOver: handleFolderDragOver,
      onDragLeave: handleFolderDragLeave,
      onDrop: handleFolderDrop,
    }
  }, [handleFolderDragEnter, handleFolderDragLeave, handleFolderDragOver, handleFolderDrop])

  return {
    isDragOver,
    isBlinking,
    dragHandlers,
  }
}
