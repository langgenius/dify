'use client'

import type { NodeApi } from 'react-arborist'
import type { TreeNodeData } from '../type'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useStore } from '@/app/components/workflow/store'
import { isFileDrag } from '../utils/drag-utils'
import { useFileDrop } from './use-file-drop'

type UseFolderFileDropReturn = {
  isDragOver: boolean
  dragHandlers: {
    onDragEnter: (e: React.DragEvent) => void
    onDragOver: (e: React.DragEvent) => void
    onDragLeave: (e: React.DragEvent) => void
    onDrop: (e: React.DragEvent) => void
  }
}

const AUTO_EXPAND_DELAY_MS = 2000

export function useFolderFileDrop(node: NodeApi<TreeNodeData>): UseFolderFileDropReturn {
  const isFolder = node.data.node_type === 'folder'
  const dragOverFolderId = useStore(s => s.dragOverFolderId)
  const isDragOver = isFolder && dragOverFolderId === node.data.id

  const { handleDragOver, handleDrop } = useFileDrop()

  const expandTimerRef = useRef<NodeJS.Timeout | null>(null)
  const dragCounterRef = useRef(0)

  const clearExpandTimer = useCallback(() => {
    if (expandTimerRef.current) {
      clearTimeout(expandTimerRef.current)
      expandTimerRef.current = null
    }
  }, [])

  const scheduleAutoExpand = useCallback(() => {
    if (!isFolder || node.isOpen)
      return
    clearExpandTimer()
    expandTimerRef.current = setTimeout(() => {
      expandTimerRef.current = null
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
    dragHandlers,
  }
}
