import type { FileEntity, FileUploadConfig } from '../types'
import { produce } from 'immer'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { v4 as uuid4 } from 'uuid'
import { fileUpload, getFileUploadErrorMessage } from '@/app/components/base/file-uploader/utils'
import Toast from '@/app/components/base/toast'
import { useFileUploadConfig } from '@/service/use-common'
import { ACCEPT_TYPES } from '../constants'
import { useFileStore } from '../store'
import { getFileType, getFileUploadConfig, traverseFileEntry } from '../utils'

export const useUpload = () => {
  const { t } = useTranslation()
  const fileStore = useFileStore()

  const [dragging, setDragging] = useState(false)
  const uploaderRef = useRef<HTMLInputElement>(null)
  const dragRef = useRef<HTMLDivElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)

  const { data: fileUploadConfigResponse } = useFileUploadConfig()

  const fileUploadConfig: FileUploadConfig = useMemo(() => {
    return getFileUploadConfig(fileUploadConfigResponse)
  }, [fileUploadConfigResponse])

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

  const checkFileType = useCallback((file: File) => {
    const ext = getFileType(file)
    return ACCEPT_TYPES.includes(ext.toLowerCase())
  }, [])

  const checkFileSize = useCallback((file: File) => {
    const { size } = file
    return size <= fileUploadConfig.imageFileSizeLimit * 1024 * 1024
  }, [fileUploadConfig])

  const showErrorMessage = useCallback((type: 'type' | 'size') => {
    if (type === 'type')
      Toast.notify({ type: 'error', message: t('fileUploader.fileExtensionNotSupport', { ns: 'common' }) })
    else
      Toast.notify({ type: 'error', message: t('imageUploader.fileSizeLimitExceeded', { ns: 'dataset', size: fileUploadConfig.imageFileSizeLimit }) })
  }, [fileUploadConfig, t])

  const getValidFiles = useCallback((files: File[]) => {
    let validType = true
    let validSize = true
    const validFiles = files.filter((file) => {
      if (!checkFileType(file)) {
        validType = false
        return false
      }
      if (!checkFileSize(file)) {
        validSize = false
        return false
      }
      return true
    })
    if (!validType)
      showErrorMessage('type')
    else if (!validSize)
      showErrorMessage('size')

    return validFiles
  }, [checkFileType, checkFileSize, showErrorMessage])

  const selectHandle = () => {
    if (uploaderRef.current)
      uploaderRef.current.click()
  }

  const handleAddFile = useCallback((newFile: FileEntity) => {
    const {
      files,
      setFiles,
    } = fileStore.getState()

    const newFiles = produce(files, (draft) => {
      draft.push(newFile)
    })
    setFiles(newFiles)
  }, [fileStore])

  const handleUpdateFile = useCallback((newFile: FileEntity) => {
    const {
      files,
      setFiles,
    } = fileStore.getState()

    const newFiles = produce(files, (draft) => {
      const index = draft.findIndex(file => file.id === newFile.id)

      if (index > -1)
        draft[index] = newFile
    })
    setFiles(newFiles)
  }, [fileStore])

  const handleRemoveFile = useCallback((fileId: string) => {
    const {
      files,
      setFiles,
    } = fileStore.getState()

    const newFiles = files.filter(file => file.id !== fileId)
    setFiles(newFiles)
  }, [fileStore])

  const handleReUploadFile = useCallback((fileId: string) => {
    const {
      files,
      setFiles,
    } = fileStore.getState()
    const index = files.findIndex(file => file.id === fileId)

    if (index > -1) {
      const uploadingFile = files[index]
      const newFiles = produce(files, (draft) => {
        draft[index].progress = 0
      })
      setFiles(newFiles)
      fileUpload({
        file: uploadingFile.originalFile!,
        onProgressCallback: (progress) => {
          handleUpdateFile({ ...uploadingFile, progress })
        },
        onSuccessCallback: (res) => {
          handleUpdateFile({ ...uploadingFile, uploadedId: res.id, progress: 100 })
        },
        onErrorCallback: (error?: any) => {
          const errorMessage = getFileUploadErrorMessage(error, t('fileUploader.uploadFromComputerUploadError', { ns: 'common' }), t)
          Toast.notify({ type: 'error', message: errorMessage })
          handleUpdateFile({ ...uploadingFile, progress: -1 })
        },
      })
    }
  }, [fileStore, t, handleUpdateFile])

  const handleLocalFileUpload = useCallback((file: File) => {
    const reader = new FileReader()
    const isImage = file.type.startsWith('image')

    reader.addEventListener(
      'load',
      () => {
        const uploadingFile = {
          id: uuid4(),
          name: file.name,
          extension: getFileType(file),
          mimeType: file.type,
          size: file.size,
          progress: 0,
          originalFile: file,
          base64Url: isImage ? reader.result as string : '',
        }
        handleAddFile(uploadingFile)
        fileUpload({
          file: uploadingFile.originalFile,
          onProgressCallback: (progress) => {
            handleUpdateFile({ ...uploadingFile, progress })
          },
          onSuccessCallback: (res) => {
            handleUpdateFile({
              ...uploadingFile,
              extension: res.extension,
              mimeType: res.mime_type,
              size: res.size,
              uploadedId: res.id,
              progress: 100,
            })
          },
          onErrorCallback: (error?: any) => {
            const errorMessage = getFileUploadErrorMessage(error, t('fileUploader.uploadFromComputerUploadError', { ns: 'common' }), t)
            Toast.notify({ type: 'error', message: errorMessage })
            handleUpdateFile({ ...uploadingFile, progress: -1 })
          },
        })
      },
      false,
    )
    reader.addEventListener(
      'error',
      () => {
        Toast.notify({ type: 'error', message: t('fileUploader.uploadFromComputerReadError', { ns: 'common' }) })
      },
      false,
    )
    reader.readAsDataURL(file)
  }, [t, handleAddFile, handleUpdateFile])

  const handleFileUpload = useCallback((newFiles: File[]) => {
    const { files } = fileStore.getState()
    const { singleChunkAttachmentLimit } = fileUploadConfig
    if (newFiles.length === 0)
      return
    if (files.length + newFiles.length > singleChunkAttachmentLimit) {
      Toast.notify({
        type: 'error',
        message: t('imageUploader.singleChunkAttachmentLimitTooltip', { ns: 'datasetHitTesting', limit: singleChunkAttachmentLimit }),
      })
      return
    }
    for (const file of newFiles)
      handleLocalFileUpload(file)
  }, [fileUploadConfig, fileStore, t, handleLocalFileUpload])

  const fileChangeHandle = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const { imageFileBatchLimit } = fileUploadConfig
    const files = Array.from(e.target.files ?? []).slice(0, imageFileBatchLimit)
    const validFiles = getValidFiles(files)
    handleFileUpload(validFiles)
  }, [getValidFiles, handleFileUpload, fileUploadConfig])

  const handleDrop = useCallback(async (e: DragEvent) => {
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
    const files = nested.flat().slice(0, fileUploadConfig.imageFileBatchLimit)
    const validFiles = getValidFiles(files)
    handleFileUpload(validFiles)
  }, [fileUploadConfig, handleFileUpload, getValidFiles])

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

  return {
    dragging,
    fileUploadConfig,
    dragRef,
    dropRef,
    uploaderRef,
    fileChangeHandle,
    selectHandle,
    handleRemoveFile,
    handleReUploadFile,
    handleLocalFileUpload,
  }
}
