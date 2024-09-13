import type { ClipboardEvent } from 'react'
import {
  useCallback,
  useState,
} from 'react'
import { useParams } from 'next/navigation'
import produce from 'immer'
import { v4 as uuid4 } from 'uuid'
import { useTranslation } from 'react-i18next'
import type { FileEntity } from './types'
import { useFileStore } from './store'
import { fileUpload } from './utils'
import { useToastContext } from '@/app/components/base/toast'

export const useFile = () => {
  const { t } = useTranslation()
  const { notify } = useToastContext()
  const fileStore = useFileStore()
  const params = useParams()

  const handleAddOrUpdateFiles = useCallback((newFile: FileEntity) => {
    const {
      files,
      setFiles,
    } = fileStore.getState()

    const newFiles = produce(files, (draft) => {
      const index = draft.findIndex(file => file.fileId === newFile.fileId)

      if (index > -1)
        draft[index] = newFile
      else
        draft.push(newFile)
    })
    setFiles(newFiles)
  }, [fileStore])

  const handleRemoveFile = useCallback((fileId: string) => {
    const {
      files,
      setFiles,
    } = fileStore.getState()

    const newFiles = files.filter(file => file.fileId !== fileId)
    setFiles(newFiles)
  }, [fileStore])

  const handleReUploadFile = useCallback((fileId: string) => {
    const {
      files,
      setFiles,
    } = fileStore.getState()
    const index = files.findIndex(file => file.fileId === fileId)

    if (index > -1) {
      const uploadingFile = files[index]
      const newFiles = produce(files, (draft) => {
        draft[index].progress = 0
      })
      setFiles(newFiles)
      fileUpload({
        file: uploadingFile.file!,
        onProgressCallback: (progress) => {
          handleAddOrUpdateFiles({ ...uploadingFile, progress })
        },
        onSuccessCallback: (res) => {
          handleAddOrUpdateFiles({ ...uploadingFile, fileId: res.id, progress: 100 })
        },
        onErrorCallback: () => {
          notify({ type: 'error', message: t('common.imageUploader.uploadFromComputerUploadError') })
          handleAddOrUpdateFiles({ ...uploadingFile, progress: -1 })
        },
      }, !!params.token)
    }
  }, [fileStore, notify, t, handleAddOrUpdateFiles, params])

  const handleLoadFileFromLink = useCallback(() => {}, [])

  const handleLoadFileFromLinkSuccess = useCallback(() => { }, [])

  const handleLoadFileFromLinkError = useCallback(() => { }, [])

  const handleClearFiles = useCallback(() => {
    const {
      setFiles,
    } = fileStore.getState()
    setFiles([])
  }, [fileStore])

  const handleLocalFileUpload = useCallback((file: File) => {
    const reader = new FileReader()
    const isImage = file.type.startsWith('image')
    reader.addEventListener(
      'load',
      () => {
        const uploadingFile = {
          fileId: uuid4(),
          file,
          url: '',
          progress: 0,
          base64Url: isImage ? reader.result as string : '',
        }
        handleAddOrUpdateFiles(uploadingFile)
        fileUpload({
          file: uploadingFile.file,
          onProgressCallback: (progress) => {
            handleAddOrUpdateFiles({ ...uploadingFile, progress })
          },
          onSuccessCallback: (res) => {
            handleAddOrUpdateFiles({ ...uploadingFile, fileStorageId: res.id, progress: 100 })
          },
          onErrorCallback: () => {
            notify({ type: 'error', message: t('common.imageUploader.uploadFromComputerUploadError') })
            handleAddOrUpdateFiles({ ...uploadingFile, progress: -1 })
          },
        }, !!params.token)
      },
      false,
    )
    reader.addEventListener(
      'error',
      () => {
        notify({ type: 'error', message: t('common.imageUploader.uploadFromComputerReadError') })
      },
      false,
    )
    reader.readAsDataURL(file)
  }, [notify, t, handleAddOrUpdateFiles, params.token])

  const handleClipboardPasteFile = useCallback((e: ClipboardEvent<HTMLTextAreaElement>) => {
    const file = e.clipboardData?.files[0]
    if (file) {
      e.preventDefault()
      handleLocalFileUpload(file)
    }
  }, [handleLocalFileUpload])

  const [isDragActive, setIsDragActive] = useState(false)
  const handleDragFileEnter = useCallback((e: React.DragEvent<HTMLElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragActive(true)
  }, [])

  const handleDragFileOver = useCallback((e: React.DragEvent<HTMLElement>) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDragFileLeave = useCallback((e: React.DragEvent<HTMLElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragActive(false)
  }, [])

  const handleDropFile = useCallback((e: React.DragEvent<HTMLElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragActive(false)

    const file = e.dataTransfer.files[0]

    if (file)
      handleLocalFileUpload(file)
  }, [handleLocalFileUpload])

  return {
    handleAddOrUpdateFiles,
    handleRemoveFile,
    handleReUploadFile,
    handleLoadFileFromLink,
    handleLoadFileFromLinkSuccess,
    handleLoadFileFromLinkError,
    handleClearFiles,
    handleLocalFileUpload,
    handleClipboardPasteFile,
    isDragActive,
    handleDragFileEnter,
    handleDragFileOver,
    handleDragFileLeave,
    handleDropFile,
  }
}
