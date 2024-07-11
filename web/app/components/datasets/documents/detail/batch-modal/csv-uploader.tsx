'use client'
import type { FC } from 'react'
import React, { useEffect, useRef, useState } from 'react'
import {
  RiDeleteBinLine,
} from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import cn from '@/utils/classnames'
import { Csv as CSVIcon } from '@/app/components/base/icons/src/public/files'
import { ToastContext } from '@/app/components/base/toast'
import Button from '@/app/components/base/button'

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
      notify({ type: 'error', message: t('datasetCreation.stepOne.uploader.validation.count') })
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
    <div className='mt-6'>
      <input
        ref={fileUploader}
        style={{ display: 'none' }}
        type="file"
        id="fileUploader"
        accept='.csv'
        onChange={fileChangeHandle}
      />
      <div ref={dropRef}>
        {!file && (
          <div className={cn('flex items-center h-20 rounded-xl bg-gray-50 border border-dashed border-gray-200 text-sm font-normal', dragging && 'bg-[#F5F8FF] border border-[#B2CCFF]')}>
            <div className='w-full flex items-center justify-center space-x-2'>
              <CSVIcon className="shrink-0" />
              <div className='text-gray-500'>
                {t('datasetDocuments.list.batchModal.csvUploadTitle')}
                <span className='text-primary-400 cursor-pointer' onClick={selectHandle}>{t('datasetDocuments.list.batchModal.browse')}</span>
              </div>
            </div>
            {dragging && <div ref={dragRef} className='absolute w-full h-full top-0 left-0' />}
          </div>
        )}
        {file && (
          <div className={cn('flex items-center h-20 px-6 rounded-xl bg-gray-50 border border-gray-200 text-sm font-normal group', 'hover:bg-[#F5F8FF] hover:border-[#B2CCFF]')}>
            <CSVIcon className="shrink-0" />
            <div className='flex ml-2 w-0 grow'>
              <span className='max-w-[calc(100%_-_30px)] text-ellipsis whitespace-nowrap overflow-hidden text-gray-800'>{file.name.replace(/.csv$/, '')}</span>
              <span className='shrink-0 text-gray-500'>.csv</span>
            </div>
            <div className='hidden group-hover:flex items-center'>
              <Button onClick={selectHandle}>{t('datasetCreation.stepOne.uploader.change')}</Button>
              <div className='mx-2 w-px h-4 bg-gray-200' />
              <div className='p-2 cursor-pointer' onClick={removeFile}>
                <RiDeleteBinLine className='w-4 h-4 text-gray-500' />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default React.memo(CSVUploader)
