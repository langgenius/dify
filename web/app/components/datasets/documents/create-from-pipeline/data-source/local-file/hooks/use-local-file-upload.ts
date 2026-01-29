import type { CustomFile as File, FileItem } from '@/models/datasets'
import { produce } from 'immer'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import { getFileUploadErrorMessage } from '@/app/components/base/file-uploader/utils'
import { ToastContext } from '@/app/components/base/toast'
import { IS_CE_EDITION } from '@/config'
import { useLocale } from '@/context/i18n'
import { LanguagesSupported } from '@/i18n-config/language'
import { upload } from '@/service/base'
import { useFileUploadConfig } from '@/service/use-common'
import { useDataSourceStore, useDataSourceStoreWithSelector } from '../../store'
import { PROGRESS_ERROR, PROGRESS_NOT_STARTED } from '../constants'

export type UseLocalFileUploadOptions = {
  allowedExtensions: string[]
  supportBatchUpload?: boolean
}

type FileUploadConfig = {
  file_size_limit: number
  batch_count_limit: number
  file_upload_limit: number
}

export const useLocalFileUpload = ({
  allowedExtensions,
  supportBatchUpload = true,
}: UseLocalFileUploadOptions) => {
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)
  const locale = useLocale()
  const localFileList = useDataSourceStoreWithSelector(state => state.localFileList)
  const dataSourceStore = useDataSourceStore()
  const [dragging, setDragging] = useState(false)

  const dropRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<HTMLDivElement>(null)
  const fileUploaderRef = useRef<HTMLInputElement>(null)
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
      .map(item => extensionMap[item] || item)
      .map(item => item.toLowerCase())
      .filter((item, index, self) => self.indexOf(item) === index)
      .map(item => item.toUpperCase())
      .join(locale !== LanguagesSupported[1] ? ', ' : '、 ')
  }, [locale, allowedExtensions])

  const acceptTypes = useMemo(
    () => allowedExtensions.map((ext: string) => `.${ext}`),
    [allowedExtensions],
  )

  const fileUploadConfig: FileUploadConfig = useMemo(() => ({
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

  const getFileType = (currentFile: File) => {
    if (!currentFile)
      return ''

    const arr = currentFile.name.split('.')
    return arr[arr.length - 1]
  }

  const isValid = useCallback((file: File) => {
    const { size } = file
    const ext = `.${getFileType(file)}`
    const isValidType = acceptTypes.includes(ext.toLowerCase())
    if (!isValidType)
      notify({ type: 'error', message: t('stepOne.uploader.validation.typeError', { ns: 'datasetCreation' }) })

    const isValidSize = size <= fileUploadConfig.file_size_limit * 1024 * 1024
    if (!isValidSize)
      notify({ type: 'error', message: t('stepOne.uploader.validation.size', { ns: 'datasetCreation', size: fileUploadConfig.file_size_limit }) })

    return isValidType && isValidSize
  }, [notify, t, acceptTypes, fileUploadConfig.file_size_limit])

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
          progress: PROGRESS_NOT_STARTED,
        }
        const index = fileListRef.current.findIndex(item => item.fileID === fileItem.fileID)
        fileListRef.current[index] = completeFile
        updateFile(completeFile, 100, fileListRef.current)
        return Promise.resolve({ ...completeFile })
      })
      .catch((e) => {
        const errorMessage = getFileUploadErrorMessage(e, t('stepOne.uploader.failed', { ns: 'datasetCreation' }), t)
        notify({ type: 'error', message: errorMessage })
        updateFile(fileItem, PROGRESS_ERROR, fileListRef.current)
        return Promise.resolve({ ...fileItem })
      })
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
      progress: PROGRESS_NOT_STARTED,
    }))
    const newFiles = [...fileListRef.current, ...preparedFiles]
    updateFileList(newFiles)
    fileListRef.current = newFiles
    uploadMultipleFiles(preparedFiles)
  }, [fileUploadConfig.file_upload_limit, localFileList.length, updateFileList, uploadMultipleFiles, notify, t])

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
    if (fileUploaderRef.current)
      fileUploaderRef.current.click()
  }, [])

  const removeFile = useCallback((fileID: string) => {
    if (fileUploaderRef.current)
      fileUploaderRef.current.value = ''

    fileListRef.current = fileListRef.current.filter(item => item.fileID !== fileID)
    updateFileList([...fileListRef.current])
  }, [updateFileList])

  const fileChangeHandle = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    let files = Array.from(e.target.files ?? []) as File[]
    files = files.slice(0, fileUploadConfig.batch_count_limit)
    initialUpload(files.filter(isValid))
  }, [isValid, initialUpload, fileUploadConfig.batch_count_limit])

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
  }, [handleDragEnter, handleDragOver, handleDragLeave, handleDrop])

  return {
    // Refs
    dropRef,
    dragRef,
    fileUploaderRef,

    // State
    dragging,
    localFileList,

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
