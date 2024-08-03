import { v4 as uuidv4 } from 'uuid'
import { useCallback, useMemo, useRef, useState } from 'react'
import type { ClipboardEvent } from 'react'
import { useParams } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { imageUpload } from './utils'
import { useToastContext } from '@/app/components/base/toast'
import { ALLOW_FILE_EXTENSIONS, TransferMethod } from '@/types/app'
import type { ImageFile, VisionSettings } from '@/types/app'
import {
  createEmptyDatasetByApi,
  createKnowledgeByFile,
  showIndexStatus,
} from '@/service/datasets' // 用户在聊天窗口上传知识库相关接口
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

type useLocalUploaderProps = {
  disabled?: boolean
  limit?: number
  secure_key?: string
  document_url?: string
  document_enable?: boolean
  onUpload: (imageFile: ImageFile) => void
}

export const useLocalFileUploader = ({ limit, disabled = false, secure_key, document_url, document_enable, onUpload }: useLocalUploaderProps) => {
  const { notify } = useToastContext()
  const params = useParams()
  const { t } = useTranslation()

  const handleLocalFileUpload = useCallback(async (file: File, isRag = false, secure_key = '', document_url = '', document_enable = false) => {
    if (disabled) {
      // TODO: leave some warnings?
      return
    }

    if (!ALLOW_FILE_EXTENSIONS.includes(file.type.split('/')[1]) && !ALLOW_FILE_EXTENSIONS.includes(file.name.split('.')[1]))
      return

    if (limit && file.size > limit * 1024 * 1024) {
      notify({ type: 'error', message: t('common.imageUploader.uploadFromComputerLimit', { size: limit }) })
      return
    }

    const reader = new FileReader()
    reader.readAsDataURL(file)
    console.log('secure_key', secure_key, document_url, document_enable)
    /**
        * 1、如果是Rag
        * 2、如果是则先创建一个空知识库
        * 3、根据创建空知识库返回的datasetId，再上传文件
        */
    if (isRag) {
      const fileFile = {
        type: TransferMethod.local_file,
        _id: `${Date.now()}`,
        fileId: '',
        file,
        url: reader.result as string,
        base64Url: reader.result as string,
        progress: 0,
        isRag: true,
        dataset_id: '',
        document_id: '',
        index_status: '',
        file_name: '',
        file_size: 0,
      }
      onUpload(fileFile)
      const publicKey = secure_key
      const dataSet = await createEmptyDatasetByApi({ name: uuidv4(), create_by_system: true, pubOutApiKey: publicKey, documentUrl: document_url })
      fileFile.progress = 30
      fileFile.index_status = '上传中'
      onUpload(fileFile)
      const knowledge = await createKnowledgeByFile({ dataSetId: dataSet.id, file, pubOutApiKey: publicKey, documentUrl: document_url })
      fileFile.progress = 99
      fileFile.index_status = '等待检索'
      onUpload(fileFile) // 此时代表文件上传成功,下一步通过定时任务,去获取文件的索引状态
      const timer = setInterval(async () => {
        const status = await showIndexStatus({ datasetID: dataSet.id, batch: knowledge.batch, pubOutApiKey: publicKey, documentUrl: document_url })
        // 下面data中是一个数组,我想拿到第一条数据请问怎么解构
        const { data } = status
        const [first] = data
        const { indexing_status, completed_segments, total_segments } = first
        if (indexing_status === 'completed' || (completed_segments === total_segments)) { // 检索成功或者已经完成
          fileFile.progress = 100 // 检索成功提示检索成功
          fileFile.fileId = knowledge?.document?.data_source_info.upload_file_id
          fileFile.url = knowledge.batch
          fileFile.dataset_id = dataSet.id
          fileFile.document_id = knowledge.document.id
          fileFile.file_name = fileFile?.file?.name
          fileFile.file_size = fileFile?.file.size
          fileFile.index_status = '索引完成'
          fileFile.index_status = `${fileFile.file_size / 1000}KB`
          onUpload(fileFile)

          clearInterval(timer)// 检索成功后清除定时器
        }
        else {
          if (fileFile.index_status === '索引完成') { // 如果是已经完成了,则清除定时器,并不再更新进度
            clearInterval(timer)
            return
          }
          fileFile.index_status = '索引中'
          fileFile.progress = completed_segments / total_segments * 100
          onUpload(fileFile)
        }
      }, 1000) // 每隔一秒去检查一次检索状态
      console.log(knowledge)
      return
    }

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
  }, [disabled, limit, notify, t, onUpload, params.token])

  return { disabled, handleLocalFileUpload }
}

type useClipboardUploaderProps = {
  files: ImageFile[]
  visionConfig?: VisionSettings
  onUpload: (imageFile: ImageFile) => void
}

export const useClipboardUploader = ({ visionConfig, onUpload, files }: useClipboardUploaderProps) => {
  const allowLocalUpload = visionConfig?.transfer_methods?.includes(TransferMethod.local_file)
  const disabled = useMemo(() =>
    !visionConfig
    || !visionConfig?.enabled
    || !allowLocalUpload
    || files.length >= visionConfig.number_limits!,
  [allowLocalUpload, files.length, visionConfig])
  const limit = useMemo(() => visionConfig ? +visionConfig.image_file_size_limit! : 0, [visionConfig])
  const { handleLocalFileUpload } = useLocalFileUploader({ limit, onUpload, disabled })

  const handleClipboardPaste = useCallback((e: ClipboardEvent<HTMLTextAreaElement>) => {
    // reserve native text copy behavior
    const file = e.clipboardData?.files[0]
    // when copyed file, prevent default action
    if (file) {
      e.preventDefault()
      handleLocalFileUpload(file)
    }
  }, [handleLocalFileUpload])

  return {
    onPaste: handleClipboardPaste,
  }
}

type useDraggableUploaderProps = {
  files: ImageFile[]
  visionConfig?: VisionSettings
  onUpload: (imageFile: ImageFile) => void
}

export const useDraggableUploader = <T extends HTMLElement>({ visionConfig, onUpload, files }: useDraggableUploaderProps) => {
  const allowLocalUpload = visionConfig?.transfer_methods?.includes(TransferMethod.local_file)
  const disabled = useMemo(() =>
    !visionConfig
    || !visionConfig?.enabled
    || !allowLocalUpload
    || files.length >= visionConfig.number_limits!,
  [allowLocalUpload, files.length, visionConfig])
  const limit = useMemo(() => visionConfig ? +visionConfig.image_file_size_limit! : 0, [visionConfig])
  const { handleLocalFileUpload } = useLocalFileUploader({ disabled, onUpload, limit })
  const [isDragActive, setIsDragActive] = useState(false)

  const handleDragEnter = useCallback((e: React.DragEvent<T>) => {
    e.preventDefault()
    e.stopPropagation()
    if (!disabled)
      setIsDragActive(true)
  }, [disabled])

  const handleDragOver = useCallback((e: React.DragEvent<T>) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent<T>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragActive(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent<T>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragActive(false)

    const file = e.dataTransfer.files[0]

    if (!file)
      return

    handleLocalFileUpload(file)
  }, [handleLocalFileUpload])

  return {
    onDragEnter: handleDragEnter,
    onDragOver: handleDragOver,
    onDragLeave: handleDragLeave,
    onDrop: handleDrop,
    isDragActive,
  }
}
