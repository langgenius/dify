import type { DragEvent } from 'react'
import { useRef, useState } from 'react'

export function useImageDrop(onFile: (file: File) => void, disabled = false) {
  const [isDragActive, setIsDragActive] = useState(false)
  const depthRef = useRef(0)
  const isFileDrag = (event: DragEvent) => event.dataTransfer.types.includes('Files')
  return {
    isDragActive: !disabled && isDragActive,
    onDragEnter(event: DragEvent<HTMLDivElement>) {
      if (!isFileDrag(event)) return
      event.preventDefault()
      event.stopPropagation()
      depthRef.current += 1
      setIsDragActive(!disabled)
    },
    onDragOver(event: DragEvent<HTMLDivElement>) {
      if (!isFileDrag(event)) return
      event.preventDefault()
      event.stopPropagation()
      event.dataTransfer.dropEffect = disabled ? 'none' : 'copy'
    },
    onDragLeave(event: DragEvent<HTMLDivElement>) {
      if (!isFileDrag(event)) return
      event.preventDefault()
      event.stopPropagation()
      depthRef.current = Math.max(0, depthRef.current - 1)
      if (!depthRef.current) setIsDragActive(false)
    },
    onDrop(event: DragEvent<HTMLDivElement>) {
      if (!isFileDrag(event)) return
      event.preventDefault()
      event.stopPropagation()
      depthRef.current = 0
      setIsDragActive(false)
      const file = event.dataTransfer.files[0]
      if (file && !disabled) onFile(file)
    },
  }
}
