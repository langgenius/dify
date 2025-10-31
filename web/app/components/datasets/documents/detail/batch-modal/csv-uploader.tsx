'use client'
import type { FC } from 'react'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  RiDeleteBinLine,
} from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import cn from '@/utils/classnames'
import { Csv as CSVIcon } from '@/app/components/base/icons/src/public/files'
import { ToastContext } from '@/app/components/base/toast'
import Button from '@/app/components/base/button'
import type { FileItem } from '@/models/datasets'
import { upload } from '@/service/base'
import { getFileUploadErrorMessage } from '@/app/components/base/file-uploader/utils'
import useSWR from 'swr'
import { fetchFileUploadConfig } from '@/service/common'
import SimplePieChart from '@/app/components/base/simple-pie-chart'
import { Theme } from '@/types/app'
import useTheme from '@/hooks/use-theme'

export type Props = {
  file: FileItem | undefined
  updateFile: (file?: FileItem) => void
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
  const { data: fileUploadConfigResponse } = useSWR({ url: '/files/upload' }, fetchFileUploadConfig)
  const fileUploadConfig = useMemo(() => fileUploadConfigResponse ?? {
    file_size_limit: 15,
  }, [fileUploadConfigResponse])

  type UploadResult = Awaited<ReturnType<typeof upload>>

  const fileUpload = useCallback(async (fileItem: FileItem): Promise<FileItem> => {
    fileItem.progress = 0

    const formData = new FormData()
    formData.append('file', fileItem.file)
    const onProgress = (e: ProgressEvent) => {
      if (e.lengthComputable) {
        const progress = Math.floor(e.loaded / e.total * 100)
        updateFile({
          ...fileItem,
          progress,
        })
      }
    }

    return upload({
      xhr: new XMLHttpRequest(),
      data: formData,
      onprogress: onProgress,
    }, false, undefined, '?source=datasets')
      .then((res: UploadResult) => {
        const updatedFile = Object.assign({}, fileItem.file, {
          id: res.id,
          ...(res as Partial<File>),
        }) as File
        const completeFile: FileItem = {
          fileID: fileItem.fileID,
          file: updatedFile,
          progress: 100,
        }
        updateFile(completeFile)
        return Promise.resolve({ ...completeFile })
      })
      .catch((e) => {
        const errorMessage = getFileUploadErrorMessage(e, t('datasetCreation.stepOne.uploader.failed'), t)
        notify({ type: 'error', message: errorMessage })
        const errorFile = {
          ...fileItem,
          progress: -2,
        }
        updateFile(errorFile)
        return Promise.resolve({ ...errorFile })
      })
      .finally()
  }, [notify, t, updateFile])

  const uploadFile = useCallback(async (fileItem: FileItem) => {
    await fileUpload(fileItem)
  }, [fileUpload])

  const initialUpload = useCallback((file?: File) => {
    if (!file)
      return false

    const newFile: FileItem = {
      fileID: `file0-${Date.now()}`,
      file,
      progress: -1,
    }
    updateFile(newFile)
    uploadFile(newFile)
  }, [updateFile, uploadFile])

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
    const files = [...e.dataTransfer.files]
    if (files.length > 1) {
      notify({ type: 'error', message: t('datasetCreation.stepOne.uploader.validation.count') })
      return
    }
    initialUpload(files[0])
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

  const getFileType = (currentFile: File) => {
    if (!currentFile)
      return ''

    const arr = currentFile.name.split('.')
    return arr[arr.length - 1]
  }

  const isValid = useCallback((file?: File) => {
    if (!file)
      return false

    const { size } = file
    const ext = `.${getFileType(file)}`
    const isValidType = ext.toLowerCase() === '.csv'
    if (!isValidType)
      notify({ type: 'error', message: t('datasetCreation.stepOne.uploader.validation.typeError') })

    const isValidSize = size <= fileUploadConfig.file_size_limit * 1024 * 1024
    if (!isValidSize)
      notify({ type: 'error', message: t('datasetCreation.stepOne.uploader.validation.size', { size: fileUploadConfig.file_size_limit }) })

    return isValidType && isValidSize
  }, [fileUploadConfig, notify, t])

  const fileChangeHandle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const currentFile = e.target.files?.[0]
    if (!isValid(currentFile))
      return

    initialUpload(currentFile)
  }

  const { theme } = useTheme()
  const chartColor = useMemo(() => theme === Theme.dark ? '#5289ff' : '#296dff', [theme])

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
          <div className={cn('flex h-20 items-center rounded-xl border border-dashed border-components-panel-border bg-components-panel-bg-blur text-sm font-normal', dragging && 'border border-divider-subtle  bg-components-panel-on-panel-item-bg-hover')}>
            <div className='flex w-full items-center justify-center space-x-2'>
              <CSVIcon className="shrink-0" />
              <div className='text-text-secondary'>
                {t('datasetDocuments.list.batchModal.csvUploadTitle')}
                <span className='cursor-pointer text-text-accent' onClick={selectHandle}>{t('datasetDocuments.list.batchModal.browse')}</span>
              </div>
            </div>
            {dragging && <div ref={dragRef} className='absolute left-0 top-0 h-full w-full' />}
          </div>
        )}
        {file && (
          <div className={cn('group flex h-20 items-center rounded-xl border border-components-panel-border bg-components-panel-bg-blur px-6 text-sm font-normal', 'hover:border-divider-subtle hover:bg-components-panel-on-panel-item-bg-hover')}>
            <CSVIcon className="shrink-0" />
            <div className='ml-2 flex w-0 grow'>
              <span className='max-w-[calc(100%_-_30px)] overflow-hidden text-ellipsis whitespace-nowrap text-text-primary'>{file.file.name.replace(/.csv$/, '')}</span>
              <span className='shrink-0 text-text-secondary'>.csv</span>
            </div>
            <div className='hidden items-center group-hover:flex'>
              {(file.progress < 100 && file.progress >= 0) && (
                <>
                  <SimplePieChart percentage={file.progress} stroke={chartColor} fill={chartColor} animationDuration={0}/>
                  <div className='mx-2 h-4 w-px bg-text-secondary'/>
                </>
              )}
              <Button onClick={selectHandle}>{t('datasetCreation.stepOne.uploader.change')}</Button>
              <div className='mx-2 h-4 w-px bg-text-secondary' />
              <div className='cursor-pointer p-2' onClick={removeFile}>
                <RiDeleteBinLine className='h-4 w-4 text-text-secondary' />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default React.memo(CSVUploader)
