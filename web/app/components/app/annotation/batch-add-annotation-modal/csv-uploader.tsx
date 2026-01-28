'use client'
import type { FC } from 'react'
import { RiDeleteBinLine } from '@remixicon/react'
import * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import Button from '@/app/components/base/button'
import { Csv as CSVIcon } from '@/app/components/base/icons/src/public/files'
import { ToastContext } from '@/app/components/base/toast'
import { cn } from '@/utils/classnames'

export type Props = {
  file: File | undefined
  updateFile: (file?: File) => void
}

const CSVUploader: FC<Props> = ({
  file,
  updateFile,
}) => {
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)
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
      notify({ type: 'error', message: t('stepOne.uploader.validation.count', { ns: 'datasetCreation' }) })
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
          <div className={cn('system-sm-regular flex h-20 items-center rounded-xl border border-dashed border-components-dropzone-border bg-components-dropzone-bg', dragging && 'border border-components-dropzone-border-accent bg-components-dropzone-bg-accent')}>
            <div className="flex w-full items-center justify-center space-x-2">
              <CSVIcon className="shrink-0" />
              <div className="text-text-tertiary">
                {t('batchModal.csvUploadTitle', { ns: 'appAnnotation' })}
                <span className="cursor-pointer text-text-accent" onClick={selectHandle}>{t('batchModal.browse', { ns: 'appAnnotation' })}</span>
              </div>
            </div>
            {dragging && <div ref={dragRef} className="absolute left-0 top-0 h-full w-full" />}
          </div>
        )}
        {file && (
          <div className={cn('group flex h-20 items-center rounded-xl border border-components-panel-border bg-components-panel-bg px-6 text-sm font-normal', 'hover:border-components-panel-bg-blur hover:bg-components-panel-bg-blur')}>
            <CSVIcon className="shrink-0" />
            <div className="ml-2 flex w-0 grow">
              <span className="max-w-[calc(100%_-_30px)] overflow-hidden text-ellipsis whitespace-nowrap text-text-primary">{file.name.replace(/.csv$/, '')}</span>
              <span className="shrink-0 text-text-tertiary">.csv</span>
            </div>
            <div className="hidden items-center group-hover:flex">
              <Button variant="secondary" onClick={selectHandle}>{t('stepOne.uploader.change', { ns: 'datasetCreation' })}</Button>
              <div className="mx-2 h-4 w-px bg-divider-regular" />
              <div className="cursor-pointer p-2" onClick={removeFile} data-testid="remove-file-button">
                <RiDeleteBinLine className="h-4 w-4 text-text-tertiary" />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default React.memo(CSVUploader)
