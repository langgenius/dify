import { useCallback, useMemo, useRef, useState } from 'react'
import type { ClipboardEvent } from 'react'
import { useParams } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { imageUpload } from './utils'
import { useToastContext } from '@/app/components/base/toast'
import { ALLOW_FILE_EXTENSIONS, TransferMethod } from '@/types/app'
import type { ImageFile, VisionSettings } from '@/types/app'

export const useImageFiles = () => {
  const params = useParams()
  const { t } = useTranslation()
  const { notify } = useToastContext()
  const [files, setFiles] = useState<ImageFile[]>([])
  const filesRef = useRef<ImageFile[]>([])

  const handleUpload = (imageFile: ImageFile) => {
    const files = filesRef.current
    const index = files.findIndex(file => file._id === imageFile._id)

    if (index > -1) {
      const currentFile = files[index]
      const newFiles = [...files.slice(0, index), { ...currentFile, ...imageFile }, ...files.slice(index + 1)]
      setFiles(newFiles)
      filesRef.current = newFiles
    }
    else {
      const newFiles = [...files, imageFile]
      setFiles(newFiles)
      filesRef.current = newFiles
    }
  }
  const handleRemove = (imageFileId: string) => {
    const files = filesRef.current
    const index = files.findIndex(file => file._id === imageFileId)

    if (index > -1) {
      const currentFile = files[index]
      const newFiles = [...files.slice(0, index), { ...currentFile, deleted: true }, ...files.slice(index + 1)]
      setFiles(newFiles)
      filesRef.current = newFiles
    }
  }
  const handleImageLinkLoadError = (imageFileId: string) => {
    const files = filesRef.current
    const index = files.findIndex(file => file._id === imageFileId)

    if (index > -1) {
      const currentFile = files[index]
      const newFiles = [...files.slice(0, index), { ...currentFile, progress: -1 }, ...files.slice(index + 1)]
      filesRef.current = newFiles
      setFiles(newFiles)
    }
  }
  const handleImageLinkLoadSuccess = (imageFileId: string) => {
    const files = filesRef.current
    const index = files.findIndex(file => file._id === imageFileId)

    if (index > -1) {
      const currentImageFile = files[index]
      const newFiles = [...files.slice(0, index), { ...currentImageFile, progress: 100 }, ...files.slice(index + 1)]
      filesRef.current = newFiles
      setFiles(newFiles)
    }
  }
  const handleReUpload = (imageFileId: string) => {
    const files = filesRef.current
    const index = files.findIndex(file => file._id === imageFileId)

    if (index > -1) {
      const currentImageFile = files[index]
      imageUpload({
        file: currentImageFile.file!,
        onProgressCallback: (progress) => {
          const newFiles = [...files.slice(0, index), { ...currentImageFile, progress }, ...files.slice(index + 1)]
          filesRef.current = newFiles
          setFiles(newFiles)
        },
        onSuccessCallback: (res) => {
          const newFiles = [...files.slice(0, index), { ...currentImageFile, fileId: res.id, progress: 100 }, ...files.slice(index + 1)]
          filesRef.current = newFiles
          setFiles(newFiles)
        },
        onErrorCallback: () => {
          notify({ type: 'error', message: t('common.imageUploader.uploadFromComputerUploadError') })
          const newFiles = [...files.slice(0, index), { ...currentImageFile, progress: -1 }, ...files.slice(index + 1)]
          filesRef.current = newFiles
          setFiles(newFiles)
        },
      }, !!params.token)
    }
  }

  const handleClear = () => {
    setFiles([])
    filesRef.current = []
  }

  const filteredFiles = useMemo(() => {
    return files.filter(file => !file.deleted)
  }, [files])

  return {
    files: filteredFiles,
    onUpload: handleUpload,
    onRemove: handleRemove,
    onImageLinkLoadError: handleImageLinkLoadError,
    onImageLinkLoadSuccess: handleImageLinkLoadSuccess,
    onReUpload: handleReUpload,
    onClear: handleClear,
  }
}

type useClipboardUploaderProps = {
  files: ImageFile[]
  visionConfig?: VisionSettings
  onUpload: (imageFile: ImageFile) => void
}

export const useClipboardUploader = ({ visionConfig, onUpload, files }: useClipboardUploaderProps) => {
  const { notify } = useToastContext()
  const params = useParams()
  const { t } = useTranslation()

  const handleClipboardPaste = useCallback((e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!visionConfig || !visionConfig.enabled)
      return

    const disabled = files.length >= visionConfig.number_limits

    if (disabled)
      // TODO: leave some warnings?
      return

    const file = e.clipboardData?.files[0]

    if (!file || !ALLOW_FILE_EXTENSIONS.includes(file.type.split('/')[1]))
      return

    const limit = +visionConfig.image_file_size_limit!

    if (file.size > limit * 1024 * 1024) {
      notify({ type: 'error', message: t('common.imageUploader.uploadFromComputerLimit', { size: limit }) })
      return
    }

    const reader = new FileReader()
    reader.addEventListener(
      'load',
      () => {
        const imageFile = {
          type: TransferMethod.local_file,
          _id: `${Date.now()}`,
          fileId: '',
          file,
          url: reader.result as string,
          base64Url: reader.result as string,
          progress: 0,
        }
        onUpload(imageFile)
        imageUpload({
          file: imageFile.file,
          onProgressCallback: (progress) => {
            onUpload({ ...imageFile, progress })
          },
          onSuccessCallback: (res) => {
            onUpload({ ...imageFile, fileId: res.id, progress: 100 })
          },
          onErrorCallback: () => {
            notify({ type: 'error', message: t('common.imageUploader.uploadFromComputerUploadError') })
            onUpload({ ...imageFile, progress: -1 })
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
  }, [visionConfig, files.length, notify, t, onUpload, params.token])

  return {
    onPaste: handleClipboardPaste,
  }
}
