'use client'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import useSWR from 'swr'
import { RiDeleteBinLine, RiUploadCloud2Line } from '@remixicon/react'
import DocumentFileIcon from '../../common/document-file-icon'
import cn from '@/utils/classnames'
import type { CustomFile as File, FileItem } from '@/models/datasets'
import { ToastContext } from '@/app/components/base/toast'
import SimplePieChart from '@/app/components/base/simple-pie-chart'

import { upload } from '@/service/base'
import { fetchFileUploadConfig } from '@/service/common'
import { fetchSupportFileTypes } from '@/service/datasets'
import I18n from '@/context/i18n'
import { LanguagesSupported } from '@/i18n/language'
import { IS_CE_EDITION } from '@/config'
import { useAppContext } from '@/context/app-context'
import { Theme } from '@/types/app'

const FILES_NUMBER_LIMIT = 20

type IFileUploaderProps = {
  fileList: FileItem[]
  titleClassName?: string
  prepareFileList: (files: FileItem[]) => void
  onFileUpdate: (fileItem: FileItem, progress: number, list: FileItem[]) => void
  onFileListUpdate?: (files: FileItem[]) => void
  onPreview: (file: File) => void
  notSupportBatchUpload?: boolean
}

const FileUploader = ({
  fileList,
  titleClassName,
  prepareFileList,
  onFileUpdate,
  onFileListUpdate,
  onPreview,
  notSupportBatchUpload,
}: IFileUploaderProps) => {
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)
  const { locale } = useContext(I18n)
  const [dragging, setDragging] = useState(false)
  const dropRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<HTMLDivElement>(null)
  const fileUploader = useRef<HTMLInputElement>(null)
  const hideUpload = notSupportBatchUpload && fileList.length > 0

  const { data: fileUploadConfigResponse } = useSWR({ url: '/files/upload' }, fetchFileUploadConfig)
  const { data: supportFileTypesResponse } = useSWR({ url: '/files/support-type' }, fetchSupportFileTypes)
  const supportTypes = supportFileTypesResponse?.allowed_extensions || []
  const supportTypesShowNames = (() => {
    const extensionMap: { [key: string]: string } = {
      md: 'markdown',
      pptx: 'pptx',
      htm: 'html',
      xlsx: 'xlsx',
      docx: 'docx',
    }

    return [...supportTypes]
      .map(item => extensionMap[item] || item) // map to standardized extension
      .map(item => item.toLowerCase()) // convert to lower case
      .filter((item, index, self) => self.indexOf(item) === index) // remove duplicates
      .map(item => item.toUpperCase()) // convert to upper case
      .join(locale !== LanguagesSupported[1] ? ', ' : '、 ')
  })()
  const ACCEPTS = supportTypes.map((ext: string) => `.${ext}`)
  const fileUploadConfig = useMemo(() => fileUploadConfigResponse ?? {
    file_size_limit: 15,
    batch_count_limit: 5,
  }, [fileUploadConfigResponse])

  const fileListRef = useRef<FileItem[]>([])

  // utils
  const getFileType = (currentFile: File) => {
    if (!currentFile)
      return ''

    const arr = currentFile.name.split('.')
    return arr[arr.length - 1]
  }

  const getFileSize = (size: number) => {
    if (size / 1024 < 10)
      return `${(size / 1024).toFixed(2)}KB`

    return `${(size / 1024 / 1024).toFixed(2)}MB`
  }

  const isValid = useCallback((file: File) => {
    const { size } = file
    const ext = `.${getFileType(file)}`
    const isValidType = ACCEPTS.includes(ext.toLowerCase())
    if (!isValidType)
      notify({ type: 'error', message: t('datasetCreation.stepOne.uploader.validation.typeError') })

    const isValidSize = size <= fileUploadConfig.file_size_limit * 1024 * 1024
    if (!isValidSize)
      notify({ type: 'error', message: t('datasetCreation.stepOne.uploader.validation.size', { size: fileUploadConfig.file_size_limit }) })

    return isValidType && isValidSize
  }, [fileUploadConfig, notify, t, ACCEPTS])

  const fileUpload = useCallback(async (fileItem: FileItem): Promise<FileItem> => {
    const formData = new FormData()
    formData.append('file', fileItem.file)
    const onProgress = (e: ProgressEvent) => {
      if (e.lengthComputable) {
        const percent = Math.floor(e.loaded / e.total * 100)
        onFileUpdate(fileItem, percent, fileListRef.current)
      }
    }

    return upload({
      xhr: new XMLHttpRequest(),
      data: formData,
      onprogress: onProgress,
    }, false, undefined, '?source=datasets')
      .then((res: File) => {
        const completeFile = {
          fileID: fileItem.fileID,
          file: res,
          progress: -1,
        }
        const index = fileListRef.current.findIndex(item => item.fileID === fileItem.fileID)
        fileListRef.current[index] = completeFile
        onFileUpdate(completeFile, 100, fileListRef.current)
        return Promise.resolve({ ...completeFile })
      })
      .catch((e) => {
        notify({ type: 'error', message: e?.response?.code === 'forbidden' ? e?.response?.message : t('datasetCreation.stepOne.uploader.failed') })
        onFileUpdate(fileItem, -2, fileListRef.current)
        return Promise.resolve({ ...fileItem })
      })
      .finally()
  }, [fileListRef, notify, onFileUpdate, t])

  const uploadBatchFiles = useCallback((bFiles: FileItem[]) => {
    bFiles.forEach(bf => (bf.progress = 0))
    return Promise.all(bFiles.map(fileUpload))
  }, [fileUpload])

  const uploadMultipleFiles = useCallback(async (files: FileItem[]) => {
    const batchCountLimit = fileUploadConfig.batch_count_limit
    const length = files.length
    let start = 0
    let end = 0

    while (start < length) {
      if (start + batchCountLimit > length)
        end = length
      else
        end = start + batchCountLimit
      const bFiles = files.slice(start, end)
      await uploadBatchFiles(bFiles)
      start = end
    }
  }, [fileUploadConfig, uploadBatchFiles])

  const initialUpload = useCallback((files: File[]) => {
    if (!files.length)
      return false

    if (files.length + fileList.length > FILES_NUMBER_LIMIT && !IS_CE_EDITION) {
      notify({ type: 'error', message: t('datasetCreation.stepOne.uploader.validation.filesNumber', { filesNumber: FILES_NUMBER_LIMIT }) })
      return false
    }

    const preparedFiles = files.map((file, index) => ({
      fileID: `file${index}-${Date.now()}`,
      file,
      progress: -1,
    }))
    const newFiles = [...fileListRef.current, ...preparedFiles]
    prepareFileList(newFiles)
    fileListRef.current = newFiles
    uploadMultipleFiles(preparedFiles)
  }, [prepareFileList, uploadMultipleFiles, notify, t, fileList])

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

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragging(false)
    if (!e.dataTransfer)
      return

    const files = [...e.dataTransfer.files] as File[]
    const validFiles = files.filter(isValid)
    initialUpload(validFiles)
  }, [initialUpload, isValid])

  const selectHandle = () => {
    if (fileUploader.current)
      fileUploader.current.click()
  }

  const removeFile = (fileID: string) => {
    if (fileUploader.current)
      fileUploader.current.value = ''

    fileListRef.current = fileListRef.current.filter(item => item.fileID !== fileID)
    onFileListUpdate?.([...fileListRef.current])
  }
  const fileChangeHandle = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])] as File[]
    initialUpload(files.filter(isValid))
  }, [isValid, initialUpload])

  const { theme } = useAppContext()
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
  }, [handleDrop])

  return (
    <div className="mb-5 w-[640px]">
      {!hideUpload && (
        <input
          ref={fileUploader}
          id="fileUploader"
          className="hidden"
          type="file"
          multiple={!notSupportBatchUpload}
          accept={ACCEPTS.join(',')}
          onChange={fileChangeHandle}
        />
      )}

      <div className={cn('text-text-tertiary text-sm font-semibold leading-6 mb-1', titleClassName)}>{t('datasetCreation.stepOne.uploader.title')}</div>

      {!hideUpload && (
        <div ref={dropRef} className={cn('relative box-border flex flex-col justify-center items-center gap-1 mb-2 px-4 py-3 max-w-[640px] min-h-20 leading-4 text-xs text-text-tertiary bg-components-dropzone-bg border border-dashed border-components-dropzone-border rounded-xl', dragging && 'bg-components-dropzone-bg-accent border-components-dropzone-border-accent')}>
          <div className="flex justify-center items-center min-h-5 text-sm leading-4 text-text-secondary">
            <RiUploadCloud2Line className='mr-2 size-5' />

            <span>
              {t('datasetCreation.stepOne.uploader.button')}
              {supportTypes.length > 0 && (
                <label className="ml-1 text-text-accent cursor-pointer" onClick={selectHandle}>{t('datasetCreation.stepOne.uploader.browse')}</label>
              )}
            </span>
          </div>
          <div>{t('datasetCreation.stepOne.uploader.tip', {
            size: fileUploadConfig.file_size_limit,
            supportTypes: supportTypesShowNames,
          })}</div>
          {dragging && <div ref={dragRef} className='absolute top-0 left-0 w-full h-full' />}
        </div>
      )}
      <div className='space-y-1 max-w-[640px] cursor-default'>

        {fileList.map((fileItem, index) => (
          <div
            key={`${fileItem.fileID}-${index}`}
            onClick={() => fileItem.file?.id && onPreview(fileItem.file)}
            className={cn(
              'flex items-center h-12 max-w-[640px] bg-components-panel-on-panel-item-bg text-xs leading-3 text-text-tertiary border border-components-panel-border rounded-lg shadow-xs',
              // 'border-state-destructive-border bg-state-destructive-hover',
            )}
          >
            <div className="shrink-0 flex justify-center items-center w-12">
              <DocumentFileIcon
                className="shrink-0 size-6"
                name={fileItem.file.name}
                extension={getFileType(fileItem.file)}
              />
            </div>
            <div className="grow shrink flex flex-col gap-0.5">
              <div className='flex w-full'>
                <div className="text-sm leading-4 text-text-secondary w-0 grow truncate">{fileItem.file.name}</div>
              </div>
              <div className="w-full leading-3 truncate text-text-tertiary">
                <span className='uppercase'>{getFileType(fileItem.file)}</span>
                <span className='px-1 text-text-quaternary'>·</span>
                <span>{getFileSize(fileItem.file.size)}</span>
                {/* <span className='px-1 text-text-quaternary'>·</span>
                  <span>10k characters</span> */}
              </div>
            </div>
            <div className="shrink-0 flex items-center justify-end gap-1 pr-3 w-16">
              {/* <span className="flex justify-center items-center w-6 h-6 cursor-pointer">
                  <RiErrorWarningFill className='size-4 text-text-warning' />
                </span> */}
              {(fileItem.progress < 100 && fileItem.progress >= 0) && (
                // <div className={s.percent}>{`${fileItem.progress}%`}</div>
                <SimplePieChart percentage={fileItem.progress} stroke={chartColor} fill={chartColor} animationDuration={0} />
              )}
              <span className="flex justify-center items-center w-6 h-6 cursor-pointer" onClick={(e) => {
                e.stopPropagation()
                removeFile(fileItem.fileID)
              }}>
                <RiDeleteBinLine className='size-4 text-text-tertiary' />
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default FileUploader
