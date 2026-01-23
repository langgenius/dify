'use client'
import type { CustomFile as File, FileItem } from '@/models/datasets'
import { RiDeleteBinLine, RiUploadCloud2Line } from '@remixicon/react'
import * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import { getFileUploadErrorMessage } from '@/app/components/base/file-uploader/utils'
import SimplePieChart from '@/app/components/base/simple-pie-chart'
import { ToastContext } from '@/app/components/base/toast'
import { IS_CE_EDITION } from '@/config'

import { useLocale } from '@/context/i18n'
import useTheme from '@/hooks/use-theme'
import { LanguagesSupported } from '@/i18n-config/language'
import { upload } from '@/service/base'
import { useFileSupportTypes, useFileUploadConfig } from '@/service/use-common'
import { Theme } from '@/types/app'
import { cn } from '@/utils/classnames'
import DocumentFileIcon from '../../common/document-file-icon'

type IFileUploaderProps = {
  fileList: FileItem[]
  titleClassName?: string
  prepareFileList: (files: FileItem[]) => void
  onFileUpdate: (fileItem: FileItem, progress: number, list: FileItem[]) => void
  onFileListUpdate?: (files: FileItem[]) => void
  onPreview: (file: File) => void
  supportBatchUpload?: boolean
}

const FileUploader = ({
  fileList,
  titleClassName,
  prepareFileList,
  onFileUpdate,
  onFileListUpdate,
  onPreview,
  supportBatchUpload = false,
}: IFileUploaderProps) => {
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)
  const locale = useLocale()
  const [dragging, setDragging] = useState(false)
  const dropRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<HTMLDivElement>(null)
  const fileUploader = useRef<HTMLInputElement>(null)
  const hideUpload = !supportBatchUpload && fileList.length > 0

  const { data: fileUploadConfigResponse } = useFileUploadConfig()
  const { data: supportFileTypesResponse } = useFileSupportTypes()
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
  const fileUploadConfig = useMemo(() => ({
    file_size_limit: fileUploadConfigResponse?.file_size_limit ?? 15,
    batch_count_limit: supportBatchUpload ? (fileUploadConfigResponse?.batch_count_limit ?? 5) : 1,
    file_upload_limit: supportBatchUpload ? (fileUploadConfigResponse?.file_upload_limit ?? 5) : 1,
  }), [fileUploadConfigResponse, supportBatchUpload])

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
      notify({ type: 'error', message: t('stepOne.uploader.validation.typeError', { ns: 'datasetCreation' }) })

    const isValidSize = size <= fileUploadConfig.file_size_limit * 1024 * 1024
    if (!isValidSize)
      notify({ type: 'error', message: t('stepOne.uploader.validation.size', { ns: 'datasetCreation', size: fileUploadConfig.file_size_limit }) })

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
      .then((res) => {
        const completeFile = {
          fileID: fileItem.fileID,
          file: res as unknown as File,
          progress: -1,
        }
        const index = fileListRef.current.findIndex(item => item.fileID === fileItem.fileID)
        fileListRef.current[index] = completeFile
        onFileUpdate(completeFile, 100, fileListRef.current)
        return Promise.resolve({ ...completeFile })
      })
      .catch((e) => {
        const errorMessage = getFileUploadErrorMessage(e, t('stepOne.uploader.failed', { ns: 'datasetCreation' }), t)
        notify({ type: 'error', message: errorMessage })
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
    const filesCountLimit = fileUploadConfig.file_upload_limit
    if (!files.length)
      return false

    if (files.length + fileList.length > filesCountLimit && !IS_CE_EDITION) {
      notify({ type: 'error', message: t('stepOne.uploader.validation.filesNumber', { ns: 'datasetCreation', filesNumber: filesCountLimit }) })
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
  }, [prepareFileList, uploadMultipleFiles, notify, t, fileList, fileUploadConfig])

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
  type FileWithPath = {
    relativePath?: string
  } & File
  const traverseFileEntry = useCallback(
    (entry: any, prefix = ''): Promise<FileWithPath[]> => {
      return new Promise((resolve) => {
        if (entry.isFile) {
          entry.file((file: FileWithPath) => {
            file.relativePath = `${prefix}${file.name}`
            resolve([file])
          })
        }
        else if (entry.isDirectory) {
          const reader = entry.createReader()
          const entries: any[] = []
          const read = () => {
            reader.readEntries(async (results: FileSystemEntry[]) => {
              if (!results.length) {
                const files = await Promise.all(
                  entries.map(ent =>
                    traverseFileEntry(ent, `${prefix}${entry.name}/`),
                  ),
                )
                resolve(files.flat())
              }
              else {
                entries.push(...results)
                read()
              }
            })
          }
          read()
        }
        else {
          resolve([])
        }
      })
    },
    [],
  )

  const handleDrop = useCallback(
    async (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setDragging(false)
      if (!e.dataTransfer)
        return
      const nested = await Promise.all(
        Array.from(e.dataTransfer.items).map((it) => {
          const entry = (it as any).webkitGetAsEntry?.()
          if (entry)
            return traverseFileEntry(entry)
          const f = it.getAsFile?.()
          return f ? Promise.resolve([f]) : Promise.resolve([])
        }),
      )
      let files = nested.flat()
      if (!supportBatchUpload)
        files = files.slice(0, 1)
      files = files.slice(0, fileUploadConfig.batch_count_limit)
      const valid = files.filter(isValid)
      initialUpload(valid)
    },
    [initialUpload, isValid, supportBatchUpload, traverseFileEntry, fileUploadConfig],
  )
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
    let files = Array.from(e.target.files ?? []) as File[]
    files = files.slice(0, fileUploadConfig.batch_count_limit)
    initialUpload(files.filter(isValid))
  }, [isValid, initialUpload, fileUploadConfig])

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
  }, [handleDrop])

  return (
    <div className="mb-5 w-[640px]">
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

      <div className={cn('mb-1 text-sm font-semibold leading-6 text-text-secondary', titleClassName)}>{t('stepOne.uploader.title', { ns: 'datasetCreation' })}</div>

      {!hideUpload && (
        <div ref={dropRef} className={cn('relative mb-2 box-border flex min-h-20 max-w-[640px] flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-components-dropzone-border bg-components-dropzone-bg px-4 py-3 text-xs leading-4 text-text-tertiary', dragging && 'border-components-dropzone-border-accent bg-components-dropzone-bg-accent')}>
          <div className="flex min-h-5 items-center justify-center text-sm leading-4 text-text-secondary">
            <RiUploadCloud2Line className="mr-2 size-5" />

            <span>
              {supportBatchUpload ? t('stepOne.uploader.button', { ns: 'datasetCreation' }) : t('stepOne.uploader.buttonSingleFile', { ns: 'datasetCreation' })}
              {supportTypes.length > 0 && (
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
      <div className="max-w-[640px] cursor-default space-y-1">

        {fileList.map((fileItem, index) => (
          <div
            key={`${fileItem.fileID}-${index}`}
            onClick={() => fileItem.file?.id && onPreview(fileItem.file)}
            className={cn(
              'flex h-12 max-w-[640px] items-center rounded-lg border border-components-panel-border bg-components-panel-on-panel-item-bg text-xs leading-3 text-text-tertiary shadow-xs',
              // 'border-state-destructive-border bg-state-destructive-hover',
            )}
          >
            <div className="flex w-12 shrink-0 items-center justify-center">
              <DocumentFileIcon
                size="xl"
                className="shrink-0"
                name={fileItem.file.name}
                extension={getFileType(fileItem.file)}
              />
            </div>
            <div className="flex shrink grow flex-col gap-0.5">
              <div className="flex w-full">
                <div className="w-0 grow truncate text-sm leading-4 text-text-secondary">{fileItem.file.name}</div>
              </div>
              <div className="w-full truncate leading-3 text-text-tertiary">
                <span className="uppercase">{getFileType(fileItem.file)}</span>
                <span className="px-1 text-text-quaternary">·</span>
                <span>{getFileSize(fileItem.file.size)}</span>
                {/* <span className='px-1 text-text-quaternary'>·</span>
                  <span>10k characters</span> */}
              </div>
            </div>
            <div className="flex w-16 shrink-0 items-center justify-end gap-1 pr-3">
              {/* <span className="flex justify-center items-center w-6 h-6 cursor-pointer">
                  <RiErrorWarningFill className='size-4 text-text-warning' />
                </span> */}
              {(fileItem.progress < 100 && fileItem.progress >= 0) && (
                // <div className={s.percent}>{`${fileItem.progress}%`}</div>
                <SimplePieChart percentage={fileItem.progress} stroke={chartColor} fill={chartColor} animationDuration={0} />
              )}
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
        ))}
      </div>
    </div>
  )
}

export default FileUploader
