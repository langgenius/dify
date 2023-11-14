import { useState } from 'react'
import { useParams } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { imageUpload } from './utils'
import { useToastContext } from '@/app/components/base/toast'
import type { ImageFile } from '@/types/app'

export const useImageFiles = () => {
  const params = useParams()
  const { t } = useTranslation()
  const { notify } = useToastContext()
  const [files, setFiles] = useState<ImageFile[]>([])

  const handleUpload = (imageFile: ImageFile) => {
    const newFiles = [...files, imageFile]
    setFiles(newFiles)
  }
  const handleRemove = (imageFileId: string) => {
    const index = files.findIndex(file => file._id === imageFileId)

    if (index > -1) {
      const newFiles = [...files.slice(0, index), ...files.slice(index + 1)]
      setFiles(newFiles)
    }
  }
  const handleImageLinkLoadError = (imageFileId: string) => {
    const index = files.findIndex(file => file._id === imageFileId)

    if (index > -1) {
      const currentFile = files[index]
      const newFiles = [...files.slice(0, index), { ...currentFile, progress: -1 }, ...files.slice(index + 1)]
      setFiles(newFiles)
    }
  }
  const handleImageLinkLoadSuccess = (imageFileId: string) => {
    const index = files.findIndex(file => file._id === imageFileId)

    if (index > -1) {
      const currentImageFile = files[index]
      const newFiles = [...files.slice(0, index), { ...currentImageFile, progress: 100 }, ...files.slice(index + 1)]
      setFiles(newFiles)
    }
  }
  const handleReUpload = (imageFileId: string) => {
    const index = files.findIndex(file => file._id === imageFileId)

    if (index > -1) {
      const currentImageFile = files[index]
      imageUpload({
        file: currentImageFile.file!,
        onProgressCallback: (progress) => {
          const newFiles = [...files.slice(0, index), { ...currentImageFile, progress }, ...files.slice(index + 1)]
          setFiles(newFiles)
        },
        onSuccessCallback: (res) => {
          const newFiles = [...files.slice(0, index), { ...currentImageFile, fileId: res.id, progress: 100 }, ...files.slice(index + 1)]
          setFiles(newFiles)
        },
        onErrorCallback: () => {
          notify({ type: 'error', message: t('common.imageUploader.uploadFromComputerUploadError') })
          const newFiles = [...files.slice(0, index), { ...currentImageFile, progress: -1 }, ...files.slice(index + 1)]
          setFiles(newFiles)
        },
      }, !!params.token)
    }
  }

  const handleClear = () => {
    setFiles([])
  }

  return {
    files,
    onUpload: handleUpload,
    onRemove: handleRemove,
    onImageLinkLoadError: handleImageLinkLoadError,
    onImageLinkLoadSuccess: handleImageLinkLoadSuccess,
    onReUpload: handleReUpload,
    onClear: handleClear,
  }
}
