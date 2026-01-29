'use client'
import type { RefObject } from 'react'
import type { CustomFile as File, FileItem } from '@/models/datasets'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import { getFileUploadErrorMessage } from '@/app/components/base/file-uploader/utils'
import { ToastContext } from '@/app/components/base/toast'
import { IS_CE_EDITION } from '@/config'
import { useLocale } from '@/context/i18n'
import { LanguagesSupported } from '@/i18n-config/language'
import { upload } from '@/service/base'
import { useFileSupportTypes, useFileUploadConfig } from '@/service/use-common'
import { getFileExtension } from '@/utils/format'
import { PROGRESS_COMPLETE, PROGRESS_ERROR, PROGRESS_NOT_STARTED } from '../constants'

export type FileUploadConfig = {
  file_size_limit: number
  batch_count_limit: number
  file_upload_limit: number
}

export type UseFileUploadOptions = {
  fileList: FileItem[]
  prepareFileList: (files: FileItem[]) => void
  onFileUpdate: (fileItem: FileItem, progress: number, list: FileItem[]) => void
  onFileListUpdate?: (files: FileItem[]) => void
  onPreview: (file: File) => void
  supportBatchUpload?: boolean
  /**
   * Optional list of allowed file extensions. If not provided, fetches from API.
   * Pass this when you need custom extension filtering instead of using the global config.
   */
  allowedExtensions?: string[]
}

export type UseFileUploadReturn = {
  // Refs
  dropRef: RefObject<HTMLDivElement | null>
  dragRef: RefObject<HTMLDivElement | null>
  fileUploaderRef: RefObject<HTMLInputElement | null>

  // State
  dragging: boolean

  // Config
  fileUploadConfig: FileUploadConfig
  acceptTypes: string[]
  supportTypesShowNames: string
  hideUpload: boolean

  // Handlers
  selectHandle: () => void
  fileChangeHandle: (e: React.ChangeEvent<HTMLInputElement>) => void
  removeFile: (fileID: string) => void
  handlePreview: (file: File) => void
}

type FileWithPath = {
  relativePath?: string
} & File

export const useFileUpload = ({
  fileList,
  prepareFileList,
  onFileUpdate,
  onFileListUpdate,
  onPreview,
  supportBatchUpload = false,
  allowedExtensions,
}: UseFileUploadOptions): UseFileUploadReturn => {
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)
  const locale = useLocale()

  const [dragging, setDragging] = useState(false)
  const dropRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<HTMLDivElement>(null)
  const fileUploaderRef = useRef<HTMLInputElement>(null)
  const fileListRef = useRef<FileItem[]>([])

  const hideUpload = !supportBatchUpload && fileList.length > 0

  const { data: fileUploadConfigResponse } = useFileUploadConfig()
  const { data: supportFileTypesResponse } = useFileSupportTypes()
  // Use provided allowedExtensions or fetch from API
  const supportTypes = useMemo(
    () => allowedExtensions ?? supportFileTypesResponse?.allowed_extensions ?? [],
    [allowedExtensions, supportFileTypesResponse?.allowed_extensions],
  )

  const supportTypesShowNames = useMemo(() => {
    const extensionMap: { [key: string]: string } = {
      md: 'markdown',
      pptx: 'pptx',
      htm: 'html',
      xlsx: 'xlsx',
      docx: 'docx',
    }

    return [...supportTypes]
      .map(item => extensionMap[item] || item)
      .map(item => item.toLowerCase())
      .filter((item, index, self) => self.indexOf(item) === index)
      .map(item => item.toUpperCase())
      .join(locale !== LanguagesSupported[1] ? ', ' : '、 ')
  }, [supportTypes, locale])

  const acceptTypes = useMemo(() => supportTypes.map((ext: string) => `.${ext}`), [supportTypes])

  const fileUploadConfig = useMemo(() => ({
    file_size_limit: fileUploadConfigResponse?.file_size_limit ?? 15,
    batch_count_limit: supportBatchUpload ? (fileUploadConfigResponse?.batch_count_limit ?? 5) : 1,
    file_upload_limit: supportBatchUpload ? (fileUploadConfigResponse?.file_upload_limit ?? 5) : 1,
  }), [fileUploadConfigResponse, supportBatchUpload])

  const isValid = useCallback((file: File) => {
    const { size } = file
    const ext = `.${getFileExtension(file.name)}`
    const isValidType = acceptTypes.includes(ext.toLowerCase())
    if (!isValidType)
      notify({ type: 'error', message: t('stepOne.uploader.validation.typeError', { ns: 'datasetCreation' }) })

    const isValidSize = size <= fileUploadConfig.file_size_limit * 1024 * 1024
    if (!isValidSize)
      notify({ type: 'error', message: t('stepOne.uploader.validation.size', { ns: 'datasetCreation', size: fileUploadConfig.file_size_limit }) })

    return isValidType && isValidSize
  }, [fileUploadConfig, notify, t, acceptTypes])

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
          progress: PROGRESS_NOT_STARTED,
        }
        const index = fileListRef.current.findIndex(item => item.fileID === fileItem.fileID)
        fileListRef.current[index] = completeFile
        onFileUpdate(completeFile, PROGRESS_COMPLETE, fileListRef.current)
        return Promise.resolve({ ...completeFile })
      })
      .catch((e) => {
        const errorMessage = getFileUploadErrorMessage(e, t('stepOne.uploader.failed', { ns: 'datasetCreation' }), t)
        notify({ type: 'error', message: errorMessage })
        onFileUpdate(fileItem, PROGRESS_ERROR, fileListRef.current)
        return Promise.resolve({ ...fileItem })
      })
      .finally()
  }, [notify, onFileUpdate, t])

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
      progress: PROGRESS_NOT_STARTED,
    }))
    const newFiles = [...fileListRef.current, ...preparedFiles]
    prepareFileList(newFiles)
    fileListRef.current = newFiles
    uploadMultipleFiles(preparedFiles)
  }, [prepareFileList, uploadMultipleFiles, notify, t, fileList, fileUploadConfig])

  const traverseFileEntry = useCallback(
    (entry: FileSystemEntry, prefix = ''): Promise<FileWithPath[]> => {
      return new Promise((resolve) => {
        if (entry.isFile) {
          (entry as FileSystemFileEntry).file((file: FileWithPath) => {
            file.relativePath = `${prefix}${file.name}`
            resolve([file])
          })
        }
        else if (entry.isDirectory) {
          const reader = (entry as FileSystemDirectoryEntry).createReader()
          const entries: FileSystemEntry[] = []
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

  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.target !== dragRef.current)
      setDragging(true)
  }, [])

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.target === dragRef.current)
      setDragging(false)
  }, [])

  const handleDrop = useCallback(
    async (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setDragging(false)
      if (!e.dataTransfer)
        return
      const nested = await Promise.all(
        Array.from(e.dataTransfer.items).map((it) => {
          const entry = (it as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntry | null }).webkitGetAsEntry?.()
          if (entry)
            return traverseFileEntry(entry)
          const f = it.getAsFile?.()
          return f ? Promise.resolve([f as FileWithPath]) : Promise.resolve([])
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

  const selectHandle = useCallback(() => {
    if (fileUploaderRef.current)
      fileUploaderRef.current.click()
  }, [])

  const removeFile = useCallback((fileID: string) => {
    if (fileUploaderRef.current)
      fileUploaderRef.current.value = ''

    fileListRef.current = fileListRef.current.filter(item => item.fileID !== fileID)
    onFileListUpdate?.([...fileListRef.current])
  }, [onFileListUpdate])

  const fileChangeHandle = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    let files = Array.from(e.target.files ?? []) as File[]
    files = files.slice(0, fileUploadConfig.batch_count_limit)
    initialUpload(files.filter(isValid))
  }, [isValid, initialUpload, fileUploadConfig])

  const handlePreview = useCallback((file: File) => {
    if (file?.id)
      onPreview(file)
  }, [onPreview])

  useEffect(() => {
    const dropArea = dropRef.current
    dropArea?.addEventListener('dragenter', handleDragEnter)
    dropArea?.addEventListener('dragover', handleDragOver)
    dropArea?.addEventListener('dragleave', handleDragLeave)
    dropArea?.addEventListener('drop', handleDrop)
    return () => {
      dropArea?.removeEventListener('dragenter', handleDragEnter)
      dropArea?.removeEventListener('dragover', handleDragOver)
      dropArea?.removeEventListener('dragleave', handleDragLeave)
      dropArea?.removeEventListener('drop', handleDrop)
    }
  }, [handleDragEnter, handleDragOver, handleDragLeave, handleDrop])

  return {
    // Refs
    dropRef,
    dragRef,
    fileUploaderRef,

    // State
    dragging,

    // Config
    fileUploadConfig,
    acceptTypes,
    supportTypesShowNames,
    hideUpload,

    // Handlers
    selectHandle,
    fileChangeHandle,
    removeFile,
    handlePreview,
  }
}
