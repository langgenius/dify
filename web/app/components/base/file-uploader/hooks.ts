import type { ClipboardEvent } from 'react'
import {
  useCallback,
  useState,
} from 'react'
import { useParams } from 'next/navigation'
import { produce } from 'immer'
import { v4 as uuid4 } from 'uuid'
import { useTranslation } from 'react-i18next'
import type { FileEntity } from './types'
import { useFileStore } from './store'
import {
  fileUpload,
  getSupportFileType,
  isAllowedFileExtension,
} from './utils'
import {
  AUDIO_SIZE_LIMIT,
  FILE_SIZE_LIMIT,
  IMG_SIZE_LIMIT,
  MAX_FILE_UPLOAD_LIMIT,
  VIDEO_SIZE_LIMIT,
} from '@/app/components/base/file-uploader/constants'
import { useToastContext } from '@/app/components/base/toast'
import { TransferMethod } from '@/types/app'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import type { FileUpload } from '@/app/components/base/features/types'
import { formatFileSize } from '@/utils/format'
import { uploadRemoteFileInfo } from '@/service/common'
import type { FileUploadConfigResponse } from '@/models/common'
import { noop } from 'lodash-es'

export const useFileSizeLimit = (fileUploadConfig?: FileUploadConfigResponse) => {
  const imgSizeLimit = Number(fileUploadConfig?.image_file_size_limit) * 1024 * 1024 || IMG_SIZE_LIMIT
  const docSizeLimit = Number(fileUploadConfig?.file_size_limit) * 1024 * 1024 || FILE_SIZE_LIMIT
  const audioSizeLimit = Number(fileUploadConfig?.audio_file_size_limit) * 1024 * 1024 || AUDIO_SIZE_LIMIT
  const videoSizeLimit = Number(fileUploadConfig?.video_file_size_limit) * 1024 * 1024 || VIDEO_SIZE_LIMIT
  const maxFileUploadLimit = Number(fileUploadConfig?.workflow_file_upload_limit) || MAX_FILE_UPLOAD_LIMIT

  return {
    imgSizeLimit,
    docSizeLimit,
    audioSizeLimit,
    videoSizeLimit,
    maxFileUploadLimit,
  }
}

export const useFile = (fileConfig: FileUpload) => {
  const { t } = useTranslation()
  const { notify } = useToastContext()
  const fileStore = useFileStore()
  const params = useParams()
  const { imgSizeLimit, docSizeLimit, audioSizeLimit, videoSizeLimit } = useFileSizeLimit(fileConfig.fileUploadConfig)

  const checkSizeLimit = useCallback((fileType: string, fileSize: number) => {
    switch (fileType) {
      case SupportUploadFileTypes.image: {
        if (fileSize > imgSizeLimit) {
          notify({
            type: 'error',
            message: t('common.fileUploader.uploadFromComputerLimit', {
              type: SupportUploadFileTypes.image,
              size: formatFileSize(imgSizeLimit),
            }),
          })
          return false
        }
        return true
      }
      case SupportUploadFileTypes.custom:
      case SupportUploadFileTypes.document: {
        if (fileSize > docSizeLimit) {
          notify({
            type: 'error',
            message: t('common.fileUploader.uploadFromComputerLimit', {
              type: SupportUploadFileTypes.document,
              size: formatFileSize(docSizeLimit),
            }),
          })
          return false
        }
        return true
      }
      case SupportUploadFileTypes.audio: {
        if (fileSize > audioSizeLimit) {
          notify({
            type: 'error',
            message: t('common.fileUploader.uploadFromComputerLimit', {
              type: SupportUploadFileTypes.audio,
              size: formatFileSize(audioSizeLimit),
            }),
          })
          return false
        }
        return true
      }
      case SupportUploadFileTypes.video: {
        if (fileSize > videoSizeLimit) {
          notify({
            type: 'error',
            message: t('common.fileUploader.uploadFromComputerLimit', {
              type: SupportUploadFileTypes.video,
              size: formatFileSize(videoSizeLimit),
            }),
          })
          return false
        }
        return true
      }
      default: {
        return true
      }
    }
  }, [audioSizeLimit, docSizeLimit, imgSizeLimit, notify, t, videoSizeLimit])

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

  const startProgressTimer = useCallback((fileId: string) => {
    const timer = setInterval(() => {
      const files = fileStore.getState().files
      const file = files.find(file => file.id === fileId)

      if (file && file.progress < 80 && file.progress >= 0)
        handleUpdateFile({ ...file, progress: file.progress + 20 })
      else
        clearTimeout(timer)
    }, 200)
  }, [fileStore, handleUpdateFile])
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
      isRemote: true,
    }
    handleAddFile(uploadingFile)
    startProgressTimer(uploadingFile.id)

    uploadRemoteFileInfo(url, !!params.token).then((res) => {
      const newFile = {
        ...uploadingFile,
        type: res.mime_type,
        size: res.size,
        progress: 100,
        supportFileType: getSupportFileType(res.name, res.mime_type, allowedFileTypes?.includes(SupportUploadFileTypes.custom)),
        uploadedId: res.id,
        url: res.url,
      }
      if (!isAllowedFileExtension(res.name, res.mime_type, fileConfig.allowed_file_types || [], fileConfig.allowed_file_extensions || [])) {
        notify({ type: 'error', message: `${t('common.fileUploader.fileExtensionNotSupport')} ${newFile.type}` })
        handleRemoveFile(uploadingFile.id)
      }
      if (!checkSizeLimit(newFile.supportFileType, newFile.size))
        handleRemoveFile(uploadingFile.id)
      else
        handleUpdateFile(newFile)
    }).catch(() => {
      notify({ type: 'error', message: t('common.fileUploader.pasteFileLinkInvalid') })
      handleRemoveFile(uploadingFile.id)
    })
  }, [checkSizeLimit, handleAddFile, handleUpdateFile, notify, t, handleRemoveFile, fileConfig?.allowed_file_types, fileConfig.allowed_file_extensions, startProgressTimer, params.token])

  const handleLoadFileFromLinkSuccess = useCallback(noop, [])

  const handleLoadFileFromLinkError = useCallback(noop, [])

  const handleClearFiles = useCallback(() => {
    const {
      setFiles,
    } = fileStore.getState()
    setFiles([])
  }, [fileStore])

  const handleLocalFileUpload = useCallback((file: File) => {
    if (!isAllowedFileExtension(file.name, file.type, fileConfig.allowed_file_types || [], fileConfig.allowed_file_extensions || [])) {
      notify({ type: 'error', message: `${t('common.fileUploader.fileExtensionNotSupport')} ${file.type}` })
      return
    }
    const allowedFileTypes = fileConfig.allowed_file_types
    const fileType = getSupportFileType(file.name, file.type, allowedFileTypes?.includes(SupportUploadFileTypes.custom))
    if (!checkSizeLimit(fileType, file.size))
      return

    const reader = new FileReader()
    const isImage = file.type.startsWith('image')

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
  }, [checkSizeLimit, notify, t, handleAddFile, handleUpdateFile, params.token, fileConfig?.allowed_file_types, fileConfig?.allowed_file_extensions])

  const handleClipboardPasteFile = useCallback((e: ClipboardEvent<HTMLTextAreaElement>) => {
    const file = e.clipboardData?.files[0]
    const text = e.clipboardData?.getData('text/plain')
    if (file && !text) {
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
