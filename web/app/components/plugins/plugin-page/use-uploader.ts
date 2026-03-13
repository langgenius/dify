import type { RefObject } from 'react'
import { useEffect, useRef, useState } from 'react'

type UploaderHookProps = {
  onFileChange: (file: File | null) => void
  containerRef: RefObject<HTMLDivElement | null>
  enabled?: boolean
}

export const useUploader = ({ onFileChange, containerRef, enabled = true }: UploaderHookProps) => {
  const [dragging, setDragging] = useState(false)
  const fileUploader = useRef<HTMLInputElement>(null)

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
    if (files.length > 0)
      onFileChange(files[0])
  }

  const fileChangeHandle = enabled
    ? (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0] || null
        onFileChange(file)
      }
    : null

  const removeFile = enabled
    ? () => {
        if (fileUploader.current)
          fileUploader.current.value = ''

        onFileChange(null)
      }
    : null

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
    fileUploader,
    fileChangeHandle,
    removeFile,
  }
}
