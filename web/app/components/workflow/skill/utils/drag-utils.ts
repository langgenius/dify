import type * as React from 'react'

export const isFileDrag = (e: React.DragEvent): boolean => {
  return e.dataTransfer.types.includes('Files')
}
