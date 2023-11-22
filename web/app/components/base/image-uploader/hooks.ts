import { useMemo, useRef, useState } from 'react'
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
