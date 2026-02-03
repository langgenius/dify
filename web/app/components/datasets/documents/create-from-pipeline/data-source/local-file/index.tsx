'use client'
import type { CustomFile as File, FileItem } from '@/models/datasets'
import { RiDeleteBinLine, RiErrorWarningFill, RiUploadCloud2Line } from '@remixicon/react'
import { produce } from 'immer'
import dynamic from 'next/dynamic'
import * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import { getFileUploadErrorMessage } from '@/app/components/base/file-uploader/utils'
import { ToastContext } from '@/app/components/base/toast'
import DocumentFileIcon from '@/app/components/datasets/common/document-file-icon'
import { IS_CE_EDITION } from '@/config'
import { useLocale } from '@/context/i18n'
import useTheme from '@/hooks/use-theme'
import { LanguagesSupported } from '@/i18n-config/language'
import { upload } from '@/service/base'
import { useFileUploadConfig } from '@/service/use-common'
import { Theme } from '@/types/app'
import { cn } from '@/utils/classnames'
import { useDataSourceStore, useDataSourceStoreWithSelector } from '../store'

const SimplePieChart = dynamic(() => import('@/app/components/base/simple-pie-chart'), { ssr: false })

export type LocalFileProps = {
  allowedExtensions: string[]
  supportBatchUpload?: boolean
}

const LocalFile = ({
  allowedExtensions,
  supportBatchUpload = true,
}: LocalFileProps) => {
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)
  const locale = useLocale()
  const localFileList = useDataSourceStoreWithSelector(state => state.localFileList)
  const dataSourceStore = useDataSourceStore()
  const [dragging, setDragging] = useState(false)

  const dropRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<HTMLDivElement>(null)
  const fileUploader = useRef<HTMLInputElement>(null)
  const fileListRef = useRef<FileItem[]>([])

  const hideUpload = !supportBatchUpload && localFileList.length > 0

  const { data: fileUploadConfigResponse } = useFileUploadConfig()
  const supportTypesShowNames = useMemo(() => {
    const extensionMap: { [key: string]: string } = {
      md: 'markdown',
      pptx: 'pptx',
      htm: 'html',
      xlsx: 'xlsx',
      docx: 'docx',
    }

    return allowedExtensions
      .map(item => extensionMap[item] || item) // map to standardized extension
      .map(item => item.toLowerCase()) // convert to lower case
      .filter((item, index, self) => self.indexOf(item) === index) // remove duplicates
      .map(item => item.toUpperCase()) // convert to upper case
      .join(locale !== LanguagesSupported[1] ? ', ' : '、 ')
  }, [locale, allowedExtensions])
  const ACCEPTS = allowedExtensions.map((ext: string) => `.${ext}`)
  const fileUploadConfig = useMemo(() => ({
    file_size_limit: fileUploadConfigResponse?.file_size_limit ?? 15,
    batch_count_limit: supportBatchUpload ? (fileUploadConfigResponse?.batch_count_limit ?? 5) : 1,
    file_upload_limit: supportBatchUpload ? (fileUploadConfigResponse?.file_upload_limit ?? 5) : 1,
  }), [fileUploadConfigResponse, supportBatchUpload])

  const updateFile = useCallback((fileItem: FileItem, progress: number, list: FileItem[]) => {
    const { setLocalFileList } = dataSourceStore.getState()
    const newList = produce(list, (draft) => {
      const targetIndex = draft.findIndex(file => file.fileID === fileItem.fileID)
      draft[targetIndex] = {
        ...draft[targetIndex],
        progress,
      }
    })
    setLocalFileList(newList)
  }, [dataSourceStore])

  const updateFileList = useCallback((preparedFiles: FileItem[]) => {
    const { setLocalFileList } = dataSourceStore.getState()
    setLocalFileList(preparedFiles)
  }, [dataSourceStore])

  const handlePreview = useCallback((file: File) => {
    const { setCurrentLocalFile } = dataSourceStore.getState()
    if (file.id)
      setCurrentLocalFile(file)
  }, [dataSourceStore])

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
      notify({ type: 'error', message: t('stepOne.uploader.validation.typeError', { ns: 'datasetCreation' }) })

    const isValidSize = size <= fileUploadConfig.file_size_limit * 1024 * 1024
    if (!isValidSize)
      notify({ type: 'error', message: t('stepOne.uploader.validation.size', { ns: 'datasetCreation', size: fileUploadConfig.file_size_limit }) })

    return isValidType && isValidSize
  }, [notify, t, ACCEPTS, fileUploadConfig.file_size_limit])

  type UploadResult = Awaited<ReturnType<typeof upload>>

  const fileUpload = useCallback(async (fileItem: FileItem): Promise<FileItem> => {
    const formData = new FormData()
    formData.append('file', fileItem.file)
    const onProgress = (e: ProgressEvent) => {
      if (e.lengthComputable) {
        const percent = Math.floor(e.loaded / e.total * 100)
        updateFile(fileItem, percent, fileListRef.current)
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
          progress: -1,
        }
        const index = fileListRef.current.findIndex(item => item.fileID === fileItem.fileID)
        fileListRef.current[index] = completeFile
        updateFile(completeFile, 100, fileListRef.current)
        return Promise.resolve({ ...completeFile })
      })
      .catch((e) => {
        const errorMessage = getFileUploadErrorMessage(e, t('stepOne.uploader.failed', { ns: 'datasetCreation' }), t)
        notify({ type: 'error', message: errorMessage })
        updateFile(fileItem, -2, fileListRef.current)
        return Promise.resolve({ ...fileItem })
      })
      .finally()
  }, [fileListRef, notify, updateFile, t])

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
    const filesCountLimit = fileUploadConfig.file_upload_limit
    if (!files.length)
      return false

    if (files.length + localFileList.length > filesCountLimit && !IS_CE_EDITION) {
      notify({ type: 'error', message: t('stepOne.uploader.validation.filesNumber', { ns: 'datasetCreation', filesNumber: filesCountLimit }) })
      return false
    }

    const preparedFiles = files.map((file, index) => ({
      fileID: `file${index}-${Date.now()}`,
      file,
      progress: -1,
    }))
    const newFiles = [...fileListRef.current, ...preparedFiles]
    updateFileList(newFiles)
    fileListRef.current = newFiles
    uploadMultipleFiles(preparedFiles)
  }, [fileUploadConfig.file_upload_limit, localFileList.length, updateFileList, uploadMultipleFiles, notify, t])

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

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragging(false)
    if (!e.dataTransfer)
      return

    let files = Array.from(e.dataTransfer.files) as File[]
    if (!supportBatchUpload)
      files = files.slice(0, 1)

    const validFiles = files.filter(isValid)
    initialUpload(validFiles)
  }, [initialUpload, isValid, supportBatchUpload])

  const selectHandle = useCallback(() => {
    if (fileUploader.current)
      fileUploader.current.click()
  }, [])

  const removeFile = (fileID: string) => {
    if (fileUploader.current)
      fileUploader.current.value = ''

    fileListRef.current = fileListRef.current.filter(item => item.fileID !== fileID)
    updateFileList([...fileListRef.current])
  }
  const fileChangeHandle = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    let files = Array.from(e.target.files ?? []) as File[]
    files = files.slice(0, fileUploadConfig.batch_count_limit)
    initialUpload(files.filter(isValid))
  }, [isValid, initialUpload, fileUploadConfig.batch_count_limit])

  const { theme } = useTheme()
  const chartColor = useMemo(() => theme === Theme.dark ? '#5289ff' : '#296dff', [theme])

  useEffect(() => {
    const dropElement = dropRef.current
    dropElement?.addEventListener('dragenter', handleDragEnter)
    dropElement?.addEventListener('dragover', handleDragOver)
    dropElement?.addEventListener('dragleave', handleDragLeave)
    dropElement?.addEventListener('drop', handleDrop)
    return () => {
      dropElement?.removeEventListener('dragenter', handleDragEnter)
      dropElement?.removeEventListener('dragover', handleDragOver)
      dropElement?.removeEventListener('dragleave', handleDragLeave)
      dropElement?.removeEventListener('drop', handleDrop)
    }
  }, [handleDrop])

  return (
    <div className="flex flex-col">
      {!hideUpload && (
        <input
          ref={fileUploader}
          id="fileUploader"
          className="hidden"
          type="file"
          multiple={supportBatchUpload}
          accept={ACCEPTS.join(',')}
          onChange={fileChangeHandle}
        />
      )}
      {!hideUpload && (
        <div
          ref={dropRef}
          className={cn(
            'relative box-border flex min-h-20 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-components-dropzone-border bg-components-dropzone-bg px-4 py-3 text-xs leading-4 text-text-tertiary',
            dragging && 'border-components-dropzone-border-accent bg-components-dropzone-bg-accent',
          )}
        >
          <div className="flex min-h-5 items-center justify-center text-sm leading-4 text-text-secondary">
            <RiUploadCloud2Line className="mr-2 size-5" />

            <span>
              {supportBatchUpload ? t('stepOne.uploader.button', { ns: 'datasetCreation' }) : t('stepOne.uploader.buttonSingleFile', { ns: 'datasetCreation' })}
              {allowedExtensions.length > 0 && (
                <label className="ml-1 cursor-pointer text-text-accent" onClick={selectHandle}>{t('stepOne.uploader.browse', { ns: 'datasetCreation' })}</label>
              )}
            </span>
          </div>
          <div>
            {t('stepOne.uploader.tip', {
              ns: 'datasetCreation',
              size: fileUploadConfig.file_size_limit,
              supportTypes: supportTypesShowNames,
              batchCount: fileUploadConfig.batch_count_limit,
              totalCount: fileUploadConfig.file_upload_limit,
            })}
          </div>
          {dragging && <div ref={dragRef} className="absolute left-0 top-0 h-full w-full" />}
        </div>
      )}
      {localFileList.length > 0 && (
        <div className="mt-1 flex flex-col gap-y-1">
          {localFileList.map((fileItem, index) => {
            const isUploading = fileItem.progress >= 0 && fileItem.progress < 100
            const isError = fileItem.progress === -2
            return (
              <div
                key={`${fileItem.fileID}-${index}`}
                onClick={handlePreview.bind(null, fileItem.file)}
                className={cn(
                  'flex h-12 items-center rounded-lg border border-components-panel-border bg-components-panel-on-panel-item-bg shadow-xs shadow-shadow-shadow-4',
                  isError && 'border-state-destructive-border bg-state-destructive-hover',
                )}
              >
                <div className="flex w-12 shrink-0 items-center justify-center">
                  <DocumentFileIcon
                    size="lg"
                    className="shrink-0"
                    name={fileItem.file.name}
                    extension={getFileType(fileItem.file)}
                  />
                </div>
                <div className="flex shrink grow flex-col gap-0.5">
                  <div className="flex w-full">
                    <div className="w-0 grow truncate text-xs text-text-secondary">{fileItem.file.name}</div>
                  </div>
                  <div className="w-full truncate text-2xs leading-3 text-text-tertiary">
                    <span className="uppercase">{getFileType(fileItem.file)}</span>
                    <span className="px-1 text-text-quaternary">·</span>
                    <span>{getFileSize(fileItem.file.size)}</span>
                  </div>
                </div>
                <div className="flex w-16 shrink-0 items-center justify-end gap-1 pr-3">
                  {isUploading && (
                    <SimplePieChart percentage={fileItem.progress} stroke={chartColor} fill={chartColor} animationDuration={0} />
                  )}
                  {
                    isError && (
                      <RiErrorWarningFill className="size-4 text-text-destructive" />
                    )
                  }
                  <span
                    className="flex h-6 w-6 cursor-pointer items-center justify-center"
                    onClick={(e) => {
                      e.stopPropagation()
                      removeFile(fileItem.fileID)
                    }}
                  >
                    <RiDeleteBinLine className="size-4 text-text-tertiary" />
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default LocalFile
