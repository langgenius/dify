'use client'

// Folder node file drop handler with VSCode-style blink animation and auto-expand

import type { NodeApi } from 'react-arborist'
import type { TreeNodeData } from '../type'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '@/app/components/workflow/store'
import { isFileDrag } from '../utils/drag-utils'
import { useFileDrop } from './use-file-drop'

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
}

export function useFolderFileDrop({ node }: UseFolderFileDropOptions): UseFolderFileDropReturn {
  const isFolder = node.data.node_type === 'folder'
  const dragOverFolderId = useStore(s => s.dragOverFolderId)
  const isDragOver = isFolder && dragOverFolderId === node.data.id

  const { handleDragOver, handleDrop } = useFileDrop()

  const expandTimerRef = useRef<NodeJS.Timeout | null>(null)
  const blinkTimerRef = useRef<NodeJS.Timeout | null>(null)
  const dragCounterRef = useRef(0)
  const [isBlinking, setIsBlinking] = useState(false)

  const clearBlinkTimer = useCallback(() => {
    if (blinkTimerRef.current) {
      clearTimeout(blinkTimerRef.current)
      blinkTimerRef.current = null
    }
    setIsBlinking(false)
  }, [])

  const clearExpandTimer = useCallback(() => {
    if (expandTimerRef.current) {
      clearTimeout(expandTimerRef.current)
      expandTimerRef.current = null
    }
    clearBlinkTimer()
  }, [clearBlinkTimer])

  const scheduleAutoExpand = useCallback(() => {
    // Skip if not a folder or already open
    if (!isFolder || node.isOpen)
      return
    clearExpandTimer()

    // Start blinking after 1 second
    blinkTimerRef.current = setTimeout(() => {
      blinkTimerRef.current = null
      setIsBlinking(true)
    }, BLINK_START_DELAY_MS)

    // Expand folder after 2 seconds
    expandTimerRef.current = setTimeout(() => {
      expandTimerRef.current = null
      setIsBlinking(false)
      if (!node.isOpen)
        node.open()
    }, AUTO_EXPAND_DELAY_MS)
  }, [clearExpandTimer, isFolder, node])

  useEffect(() => {
    return () => {
      clearExpandTimer()
    }
  }, [clearExpandTimer])

  const handleFolderDragEnter = useCallback((e: React.DragEvent) => {
    if (!isFolder || !isFileDrag(e))
      return
    dragCounterRef.current += 1
    if (dragCounterRef.current === 1)
      scheduleAutoExpand()
  }, [isFolder, scheduleAutoExpand])

  const handleFolderDragOver = useCallback((e: React.DragEvent) => {
    if (!isFolder || !isFileDrag(e))
      return
    handleDragOver(e, { folderId: node.data.id, isFolder: true })
  }, [handleDragOver, isFolder, node.data.id])

  const handleFolderDragLeave = useCallback((e: React.DragEvent) => {
    if (!isFolder || !isFileDrag(e))
      return
    dragCounterRef.current = Math.max(dragCounterRef.current - 1, 0)
    if (dragCounterRef.current === 0)
      clearExpandTimer()
  }, [clearExpandTimer, isFolder])

  const handleFolderDrop = useCallback((e: React.DragEvent) => {
    if (!isFolder)
      return
    dragCounterRef.current = 0
    clearExpandTimer()
    handleDrop(e, node.data.id)
  }, [clearExpandTimer, handleDrop, isFolder, node.data.id])

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
