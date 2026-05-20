'use client'
import type { FC } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { toast } from '@langgenius/dify-ui/toast'
import { RiDeleteBinLine } from '@remixicon/react'
import * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Csv as CSVIcon } from '@/app/components/base/icons/src/public/files'

export type Props = {
  file: File | undefined
  updateFile: (file?: File) => void
}

const CSVUploader: FC<Props> = ({
  file,
  updateFile,
}) => {
  const { t } = useTranslation()
  const [dragging, setDragging] = useState(false)
  const dropRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<HTMLDivElement>(null)
  const fileUploader = useRef<HTMLInputElement>(null)

  const handleDragEnter = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.target !== dragRef.current)
      setDragging(true)
  }
  const handleDragOver = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }
  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.target === dragRef.current)
      setDragging(false)
  }
  const handleDrop = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragging(false)
    if (!e.dataTransfer)
      return
    const files = Array.from(e.dataTransfer.files)
    if (files.length > 1) {
      toast.error(t('stepOne.uploader.validation.count', { ns: 'datasetCreation' }))
      return
    }
    updateFile(files[0])
  }
  const selectHandle = () => {
    if (fileUploader.current)
      fileUploader.current.click()
  }
  const removeFile = () => {
    if (fileUploader.current)
      fileUploader.current.value = ''
    updateFile()
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
    <div className="mt-6">
      <input
        ref={fileUploader}
        style={{ display: 'none' }}
        type="file"
        id="fileUploader"
        accept=".csv"
        onChange={fileChangeHandle}
      />
      <div ref={dropRef}>
        {!file && (
          <div className={cn('flex h-20 items-center rounded-xl border border-dashed border-components-dropzone-border bg-components-dropzone-bg system-sm-regular', dragging && 'border border-components-dropzone-border-accent bg-components-dropzone-bg-accent')}>
            <div className="flex w-full items-center justify-center space-x-2">
              <CSVIcon className="shrink-0" />
              <div className="text-text-tertiary">
                {t('batchModal.csvUploadTitle', { ns: 'appAnnotation' })}
                <button
                  type="button"
                  className="inline cursor-pointer border-none bg-transparent p-0 text-left text-text-accent focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
                  onClick={selectHandle}
                >
                  {t('batchModal.browse', { ns: 'appAnnotation' })}
                </button>
              </div>
            </div>
            {dragging && <div ref={dragRef} className="absolute top-0 left-0 h-full w-full" />}
          </div>
        )}
        {file && (
          <div className={cn('group flex h-20 items-center rounded-xl border border-components-panel-border bg-components-panel-bg px-6 text-sm font-normal', 'hover:border-components-panel-bg-blur hover:bg-components-panel-bg-blur')}>
            <CSVIcon className="shrink-0" />
            <div className="ml-2 flex w-0 grow">
              <span className="max-w-[calc(100%-30px)] overflow-hidden text-ellipsis whitespace-nowrap text-text-primary">{file.name.replace(/.csv$/, '')}</span>
              <span className="shrink-0 text-text-tertiary">.csv</span>
            </div>
            <div className="hidden items-center group-hover:flex">
              <Button variant="secondary" onClick={selectHandle}>{t('stepOne.uploader.change', { ns: 'datasetCreation' })}</Button>
              <div className="mx-2 h-4 w-px bg-divider-regular" />
              <button
                type="button"
                className="cursor-pointer border-none bg-transparent p-2 focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
                aria-label={t('operation.delete', { ns: 'common' })}
                onClick={removeFile}
              >
                <RiDeleteBinLine className="h-4 w-4 text-text-tertiary" aria-hidden="true" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default React.memo(CSVUploader)
