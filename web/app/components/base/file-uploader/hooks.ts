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
  getSupportFileType,
  isAllowedFileExtension,
} from './utils'
import { FILE_SIZE_LIMIT } from './constants'
import { useToastContext } from '@/app/components/base/toast'
import { TransferMethod } from '@/types/app'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import type { FileUpload } from '@/app/components/base/features/types'
import { formatFileSize } from '@/utils/format'
import { fetchRemoteFileInfo } from '@/service/common'

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
        onErrorCallback: () => {
          notify({ type: 'error', message: t('common.fileUploader.uploadFromComputerUploadError') })
          handleUpdateFile({ ...uploadingFile, progress: -1 })
        },
      }, !!params.token)
    }
  }, [fileStore, notify, t, handleUpdateFile, params])

  const handleLoadFileFromLink = useCallback((url: string) => {
    const allowedFileTypes = fileConfig.allowed_file_types

    const uploadingFile = {
      id: uuid4(),
      name: url,
      type: '',
      size: 0,
      progress: 0,
      transferMethod: TransferMethod.remote_url,
      supportFileType: '',
      url,
    }
    handleAddFile(uploadingFile)

    fetchRemoteFileInfo(url).then((res) => {
      const newFile = {
        ...uploadingFile,
        type: res.file_type,
        size: res.file_length,
        progress: 100,
        supportFileType: getSupportFileType(url, res.file_type, allowedFileTypes?.includes(SupportUploadFileTypes.custom)),
      }
      handleUpdateFile(newFile)
    }).catch(() => {
      notify({ type: 'error', message: t('common.fileUploader.pasteFileLinkInvalid') })
      handleRemoveFile(uploadingFile.id)
    })
  }, [handleAddFile, handleUpdateFile, notify, t, handleRemoveFile, fileConfig?.allowed_file_types])

  const handleLoadFileFromLinkSuccess = useCallback(() => { }, [])

  const handleLoadFileFromLinkError = useCallback(() => { }, [])

  const handleClearFiles = useCallback(() => {
    const {
      setFiles,
    } = fileStore.getState()
    setFiles([])
  }, [fileStore])

  const handleLocalFileUpload = useCallback((file: File) => {
    if (!isAllowedFileExtension(file.name, file.type, fileConfig.allowed_file_types || [], fileConfig.allowed_file_extensions || [])) {
      notify({ type: 'error', message: t('common.fileUploader.fileExtensionNotSupport') })
      return
    }
    if (file.size > FILE_SIZE_LIMIT) {
      notify({ type: 'error', message: t('common.fileUploader.uploadFromComputerLimit', { size: formatFileSize(FILE_SIZE_LIMIT) }) })
      return
    }
    const reader = new FileReader()
    const isImage = file.type.startsWith('image')
    const allowedFileTypes = fileConfig.allowed_file_types

    reader.addEventListener(
      'load',
      () => {
        const uploadingFile = {
          id: uuid4(),
          name: file.name,
          type: file.type,
          size: file.size,
          progress: 0,
          transferMethod: TransferMethod.local_file,
          supportFileType: getSupportFileType(file.name, file.type, allowedFileTypes?.includes(SupportUploadFileTypes.custom)),
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
            handleUpdateFile({ ...uploadingFile, uploadedId: res.id, progress: 100 })
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
  }, [notify, t, handleAddFile, handleUpdateFile, params.token, fileConfig?.allowed_file_types, fileConfig?.allowed_file_extensions])

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
