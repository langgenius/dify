import { useEffect, useState } from 'react'

export type DroppedFileType = 'dsl' | 'bundle'

type DSLDragDropHookProps = {
  onDSLFileDropped: (file: File) => void
  onBundleFileDropped?: (file: File) => void
  containerRef: React.RefObject<HTMLDivElement | null>
  enabled?: boolean
}

export const useDSLDragDrop = ({ onDSLFileDropped, onBundleFileDropped, containerRef, enabled = true }: DSLDragDropHookProps) => {
  const [dragging, setDragging] = useState(false)

  const handleDragEnter = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer?.types.includes('Files'))
      setDragging(true)
  }

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.relatedTarget === null || !containerRef.current?.contains(e.relatedTarget as Node))
      setDragging(false)
  }

  const handleDrop = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragging(false)

    if (!e.dataTransfer)
      return

    const files = Array.from(e.dataTransfer.files)
    if (files.length === 0)
      return

    const file = files[0]
    const fileName = file.name.toLowerCase()

    if (fileName.endsWith('.yaml') || fileName.endsWith('.yml')) {
      onDSLFileDropped(file)
    }
    else if (fileName.endsWith('.zip') && onBundleFileDropped) {
      onBundleFileDropped(file)
    }
  }

  useEffect(() => {
    if (!enabled)
      return

    const current = containerRef.current
    if (current) {
      current.addEventListener('dragenter', handleDragEnter)
      current.addEventListener('dragover', handleDragOver)
      current.addEventListener('dragleave', handleDragLeave)
      current.addEventListener('drop', handleDrop)
    }
    return () => {
      if (current) {
        current.removeEventListener('dragenter', handleDragEnter)
        current.removeEventListener('dragover', handleDragOver)
        current.removeEventListener('dragleave', handleDragLeave)
        current.removeEventListener('drop', handleDrop)
      }
    }
  }, [containerRef, enabled])

  return {
    dragging: enabled ? dragging : false,
  }
}
