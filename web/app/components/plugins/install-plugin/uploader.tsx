'use client'
import type { FC } from 'react'
import React, { useEffect, useRef, useState } from 'react'
import { useContext } from 'use-context-selector'
import { ToastContext } from '@/app/components/base/toast'

export type Props = {
  file: File | undefined
  updateFile: (file?: File) => void
  className?: string
}

const Uploader: FC<Props> = ({
  file,
  updateFile,
  className,
}) => {
  const { notify } = useContext(ToastContext)
  const [dragging, setDragging] = useState(false)
  const dropRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<HTMLDivElement>(null)
  const fileUploader = useRef<HTMLInputElement>(null)

  const handleDragEnter = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    e.target !== dragRef.current && setDragging(true)
  }

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    e.target === dragRef.current && setDragging(false)
  }

  const handleDrop = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragging(false)
    if (!e.dataTransfer)
      return
    const files = [...e.dataTransfer.files]
    if (files.length > 1) {
      // notify({ type: 'error', message: })
    }
    updateFile(files[0])
  }

  const selectHandle = () => {

  }

  const fileChangeHandle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const currentFile = e.target.files?.[0]
    updateFile(currentFile)
  }

  useEffect(() => {
    dropRef.current?.addEventListener('dragenter', handleDragEnter)
    dropRef.current?.addEventListener('dragover', handleDragOver)
    dropRef.current?.addEventListener('dragleave', handleDragLeave)
    dropRef.current?.addEventListener('drop', handleDrop)
    return () => {
      dropRef.current?.removeEventListener('dragenter', handleDragEnter)
      dropRef.current?.removeEventListener('dragover', handleDragOver)
      dropRef.current?.removeEventListener('dragleave', handleDragLeave)
      dropRef.current?.removeEventListener('drop', handleDrop)
    }
  }, [])

  return (
    <>
      <input
        ref={fileUploader}
        style={{ display: 'none' }}
        type="file"
        id="fileUploader"
        accept='.difypkg'
        onChange={fileChangeHandle}
      />
      {dragging && (
        <div
          ref={dragRef}
          className='flex w-full h-full p-2 items-start gap-2 absolute left-1 bottom-[3px]
            rounded-2xl border-2 border-dashed bg-components-dropzone-bg-accent'>
        </div>
      )}
    </>
  )
}

export default React.memo(Uploader)
