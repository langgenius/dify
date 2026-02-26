import { useEffect, useState } from 'react'

type DSLDragDropHookProps = {
  onDSLFileDropped: (file: File) => void
  containerRef: React.RefObject<HTMLDivElement | null>
  enabled?: boolean
}

export const useDSLDragDrop = ({ onDSLFileDropped, containerRef, enabled = true }: DSLDragDropHookProps) => {
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
    if (file.name.toLowerCase().endsWith('.yaml') || file.name.toLowerCase().endsWith('.yml'))
      onDSLFileDropped(file)
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
