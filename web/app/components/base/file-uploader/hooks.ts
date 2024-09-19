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
import {
  fileUpload,
  getFileType,
} from './utils'
import { FILE_SIZE_LIMIT } from './constants'
import { useToastContext } from '@/app/components/base/toast'
import { TransferMethod } from '@/types/app'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import type { FileUpload } from '@/app/components/base/features/types'
import { formatFileSize } from '@/utils/format'

export const useFile = (fileConfig: FileUpload) => {
  const { t } = useTranslation()
  const { notify } = useToastContext()
  const fileStore = useFileStore()
  const params = useParams()

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
      const index = draft.findIndex(file => file.fileId === newFile.fileId)

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
          handleUpdateFile({ ...uploadingFile, progress })
        },
        onSuccessCallback: (res) => {
          handleUpdateFile({ ...uploadingFile, fileId: res.id, progress: 100 })
        },
        onErrorCallback: () => {
          notify({ type: 'error', message: t('common.imageUploader.uploadFromComputerUploadError') })
          handleUpdateFile({ ...uploadingFile, progress: -1 })
        },
      }, !!params.token)
    }
  }, [fileStore, notify, t, handleUpdateFile, params])

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
    if (file.size > FILE_SIZE_LIMIT) {
      notify({ type: 'error', message: t('common.fileUploader.uploadFromComputerLimit', { size: formatFileSize(FILE_SIZE_LIMIT) }) })
      return
    }
    const reader = new FileReader()
    const isImage = file.type.startsWith('image')
    const allowedFileTypes = fileConfig.allowed_file_types
    const isCustomFileType = allowedFileTypes?.includes(SupportUploadFileTypes.custom)

    reader.addEventListener(
      'load',
      () => {
        const uploadingFile = {
          fileId: uuid4(),
          file,
          url: '',
          progress: 0,
          base64Url: isImage ? reader.result as string : '',
          fileType: isCustomFileType ? SupportUploadFileTypes.custom : getFileType(file),
          type: TransferMethod.local_file,
        }
        handleAddFile(uploadingFile)
        fileUpload({
          file: uploadingFile.file,
          onProgressCallback: (progress) => {
            handleUpdateFile({ ...uploadingFile, progress })
          },
          onSuccessCallback: (res) => {
            handleUpdateFile({ ...uploadingFile, fileStorageId: res.id, progress: 100 })
          },
          onErrorCallback: () => {
            notify({ type: 'error', message: t('common.fileUploader.uploadFromComputerUploadError') })
            handleUpdateFile({ ...uploadingFile, progress: -1 })
          },
        }, !!params.token)
      },
      false,
    )
    reader.addEventListener(
      'error',
      () => {
        notify({ type: 'error', message: t('common.fileUploader.uploadFromComputerReadError') })
      },
      false,
    )
    reader.readAsDataURL(file)
  }, [notify, t, handleAddFile, handleUpdateFile, params.token, fileConfig?.allowed_file_types])

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
    handleAddFile,
    handleUpdateFile,
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
