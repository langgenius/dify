import type * as React from 'react'
import { INTERNAL_NODE_DRAG_TYPE } from '../constants'

// Check if dragging external files from OS
export const isFileDrag = (e: React.DragEvent): boolean => {
  return e.dataTransfer.types.includes('Files')
}

// Check if dragging internal tree node
export const isNodeDrag = (e: React.DragEvent): boolean => {
  return e.dataTransfer.types.includes(INTERNAL_NODE_DRAG_TYPE)
}

// Check if any supported drag type
export const isDragEvent = (e: React.DragEvent): boolean => {
  return isFileDrag(e) || isNodeDrag(e)
}

// Get drag action type for tooltip display
export type DragActionType = 'upload' | 'move'
export const getDragActionType = (e: React.DragEvent): DragActionType | null => {
  if (isFileDrag(e))
    return 'upload'
  if (isNodeDrag(e))
    return 'move'
  return null
}
