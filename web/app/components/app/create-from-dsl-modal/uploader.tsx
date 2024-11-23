'use client'
import type { FC } from 'react'
import React, { useEffect, useRef, useState } from 'react'
import {
  RiDeleteBinLine,
} from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import { formatFileSize } from '@/utils/format'
import cn from '@/utils/classnames'
import { Yaml as YamlIcon } from '@/app/components/base/icons/src/public/files'
import { ToastContext } from '@/app/components/base/toast'
import { UploadCloud01 } from '@/app/components/base/icons/src/vender/line/general'
import Button from '@/app/components/base/button'

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
    const originalFile = file
    if (fileUploader.current) {
      fileUploader.current.value = ''
      fileUploader.current.click()
      // If no file is selected, restore the original file
      fileUploader.current.oncancel = () => updateFile(originalFile)
    }
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
    <div className={cn('mt-6', className)}>
      <input
        ref={fileUploader}
        style={{ display: 'none' }}
        type="file"
        id="fileUploader"
        accept='.yml'
        onChange={fileChangeHandle}
      />
      <div ref={dropRef}>
        {!file && (
          <div className={cn('flex items-center h-12 rounded-xl bg-gray-50 border border-dashed border-gray-200 text-sm font-normal', dragging && 'bg-[#F5F8FF] border border-[#B2CCFF]')}>
            <div className='w-full flex items-center justify-center space-x-2'>
              <UploadCloud01 className='w-6 h-6 mr-2' />
              <div className='text-gray-500'>
                {t('datasetCreation.stepOne.uploader.button')}
                <span className='pl-1 text-[#155eef] cursor-pointer' onClick={selectHandle}>{t('datasetDocuments.list.batchModal.browse')}</span>
              </div>
            </div>
            {dragging && <div ref={dragRef} className='absolute w-full h-full top-0 left-0' />}
          </div>
        )}
        {file && (
          <div className={cn('flex items-center rounded-lg bg-components-panel-on-panel-item-bg border-[0.5px] border-components-panel-border shadow-xs group', 'hover:bg-[#F5F8FF] hover:border-[#B2CCFF]')}>
            <div className='flex p-3 justify-center items-center'>
              <YamlIcon className="w-6 h-6 shrink-0" />
            </div>
            <div className='flex py-1 pr-2 grow flex-col items-start gap-0.5'>
              <span className='max-w-[calc(100%_-_30px)] text-ellipsis whitespace-nowrap overflow-hidden text-text-secondary font-inter text-[12px] font-medium leading-4'>{file.name}</span>
              <div className='flex h-3 items-center gap-1 self-stretch text-text-tertiary font-inter text-[10px] font-medium leading-3 uppercase'>
                <span>YAML</span>
                <span className='text-text-quaternary'>·</span>
                <span>{formatFileSize(file.size)}</span>
              </div>
            </div>
            <div className='hidden group-hover:flex items-center'>
              <Button onClick={selectHandle}>{t('datasetCreation.stepOne.uploader.change')}</Button>
              <div className='mx-2 w-px h-4 bg-gray-200' />
              <div className='p-2 cursor-pointer' onClick={removeFile}>
                <RiDeleteBinLine className='w-4 h-4 text-text-tertiary' />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default React.memo(Uploader)
