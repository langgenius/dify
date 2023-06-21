'use client'
import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import cn from 'classnames'
import s from './index.module.css'
import type { File as FileEntity } from '@/models/datasets'
import { ToastContext } from '@/app/components/base/toast'

import { upload } from '@/service/base'

type IFileUploaderProps = {
  fileList: any[]
  titleClassName?: string
  prepareFileList: (files: any[]) => void
  onFileUpdate: (fileItem: any, progress: number, list: any[]) => void
  onFileListUpdate?: (files: any) => void
  onPreview: (file: FileEntity) => void
}

const ACCEPTS = [
  '.pdf',
  '.html',
  '.htm',
  '.md',
  '.markdown',
  '.txt',
  // '.xls',
  '.xlsx',
  '.csv',
]

const MAX_SIZE = 15 * 1024 * 1024
const BATCH_COUNT = 5

const FileUploader = ({
  fileList,
  titleClassName,
  prepareFileList,
  onFileUpdate,
  onFileListUpdate,
  onPreview,
}: IFileUploaderProps) => {
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)
  const [dragging, setDragging] = useState(false)
  const dropRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<HTMLDivElement>(null)
  const fileUploader = useRef<HTMLInputElement>(null)

  const fileListRef = useRef<any>([])

  // utils
  const getFileType = (currentFile: File) => {
    if (!currentFile)
      return ''

    const arr = currentFile.name.split('.')
    return arr[arr.length - 1]
  }

  const getFileSize = (size: number) => {
    if (size / 1024 < 10)
      return `${(size / 1024).toFixed(2)}KB`

    return `${(size / 1024 / 1024).toFixed(2)}MB`
  }

  const isValid = (file: File) => {
    const { size } = file
    const ext = `.${getFileType(file)}`
    const isValidType = ACCEPTS.includes(ext)
    if (!isValidType)
      notify({ type: 'error', message: t('datasetCreation.stepOne.uploader.validation.typeError') })

    const isValidSize = size <= MAX_SIZE
    if (!isValidSize)
      notify({ type: 'error', message: t('datasetCreation.stepOne.uploader.validation.size') })

    return isValidType && isValidSize
  }

  const fileUpload = async (fileItem: any) => {
    const formData = new FormData()
    formData.append('file', fileItem.file)
    const onProgress = (e: ProgressEvent) => {
      if (e.lengthComputable) {
        const percent = Math.floor(e.loaded / e.total * 100)
        onFileUpdate(fileItem, percent, fileListRef.current)
      }
    }

    return upload({
      xhr: new XMLHttpRequest(),
      data: formData,
      onprogress: onProgress,
    })
      .then((res: FileEntity) => {
        const fileListCopy = fileListRef.current

        const completeFile = {
          fileID: fileItem.fileID,
          file: res,
        }
        const index = fileListCopy.findIndex((item: any) => item.fileID === fileItem.fileID)
        fileListCopy[index] = completeFile
        onFileUpdate(completeFile, 100, fileListCopy)
        return Promise.resolve({ ...completeFile })
      })
      .catch(() => {
        notify({ type: 'error', message: t('datasetCreation.stepOne.uploader.failed') })
        onFileUpdate(fileItem, -2, fileListCopy)
        return Promise.resolve({ ...fileItem })
      })
      .finally()
  }
  const uploadBatchFiles = (bFiles: any) => {
    bFiles.forEach((bf: any) => (bf.progress = 0))
    return Promise.all(bFiles.map((bFile: any) => fileUpload(bFile)))
  }
  const uploadMultipleFiles = async (files: any) => {
    const length = files.length
    let start = 0
    let end = 0

    while (start < length) {
      if (start + BATCH_COUNT > length)
        end = length
      else
        end = start + BATCH_COUNT
      const bFiles = files.slice(start, end)
      await uploadBatchFiles(bFiles)
      start = end
    }
  }
  const initialUpload = (files: any) => {
    if (!files.length)
      return false
    const preparedFiles = files.map((file: any, index: number) => {
      const fileItem = {
        fileID: `file${index}-${Date.now()}`,
        file,
        progress: -1,
      }
      return fileItem
    })
    const newFiles = [...fileListRef.current, ...preparedFiles]
    prepareFileList(newFiles)
    fileListRef.current = newFiles
    uploadMultipleFiles(preparedFiles)
  }
  const handleDragEnter = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    e.target !== dragRef.current && setDragging(true)
  }
  const handleDragOver = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }
  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    e.target === dragRef.current && setDragging(false)
  }

  const handleDrop = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragging(false)
    if (!e.dataTransfer)
      return

    const files = [...e.dataTransfer.files]
    const validFiles = files.filter(file => isValid(file))
    // fileUpload(files[0])
    initialUpload(validFiles)
  }

  const selectHandle = () => {
    if (fileUploader.current)
      fileUploader.current.click()
  }

  const removeFile = (fileID: string) => {
    if (fileUploader.current)
      fileUploader.current.value = ''

    fileListRef.current = fileListRef.current.filter((item: any) => item.fileID !== fileID)
    onFileListUpdate?.([...fileListRef.current])
  }
  const fileChangeHandle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])].filter(file => isValid(file))
    initialUpload(files)
  }

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
  }, [])

  return (
    <div className={s.fileUploader}>
      <input
        ref={fileUploader}
        id="fileUploader"
        style={{ display: 'none' }}
        type="file"
        multiple
        accept={ACCEPTS.join(',')}
        onChange={fileChangeHandle}
      />
      <div className={cn(s.title, titleClassName)}>{t('datasetCreation.stepOne.uploader.title')}</div>
      <div ref={dropRef} className={cn(s.uploader, dragging && s.dragging)}>
        <div className='flex justify-center items-center h-6 mb-2'>
          <span className={s.uploadIcon}/>
          <span>{t('datasetCreation.stepOne.uploader.button')}</span>
          <label className={s.browse} onClick={selectHandle}>{t('datasetCreation.stepOne.uploader.browse')}</label>
        </div>
        <div className={s.tip}>{t('datasetCreation.stepOne.uploader.tip')}</div>
        {dragging && <div ref={dragRef} className={s.draggingCover}/>}
      </div>
      <div className={s.fileList}>
        {fileList.map((fileItem, index) => (
          <div
            key={`${fileItem.fileID}-${index}`}
            onClick={() => fileItem.file?.id && onPreview(fileItem.file)}
            className={cn(
              s.file,
              fileItem.progress < 100 && s.uploading,
              // s.active,
            )}
          >
            {fileItem.progress < 100 && (
              <div className={s.progressbar} style={{ width: `${fileItem.progress}%` }}/>
            )}
            <div className={s.fileInfo}>
              <div className={cn(s.fileIcon, s[getFileType(fileItem.file)])}/>
              <div className={s.filename}>{fileItem.file.name}</div>
              <div className={s.size}>{getFileSize(fileItem.file.size)}</div>
            </div>
            <div className={s.actionWrapper}>
              {(fileItem.progress < 100 && fileItem.progress >= 0) && (
                <div className={s.percent}>{`${fileItem.progress}%`}</div>
              )}
              {fileItem.progress === 100 && (
                <div className={s.remove} onClick={(e) => {
                  e.stopPropagation()
                  removeFile(fileItem.fileID)
                }}/>
              )}
            </div>
          </div>
        ))}
        {/* {currentFile && (
          <div
            // onClick={() => onPreview(currentFile)}
            className={cn(
              s.file,
              uploading && s.uploading,
              // s.active,
            )}
          >
            {uploading && (
              <div className={s.progressbar} style={{ width: `${percent}%` }}/>
            )}
            <div className={s.fileInfo}>
              <div className={cn(s.fileIcon, s[getFileType(currentFile)])}/>
              <div className={s.filename}>{currentFile.name}</div>
              <div className={s.size}>{getFileSize(currentFile.size)}</div>
            </div>
            <div className={s.actionWrapper}>
              {uploading && (
                <div className={s.percent}>{`${percent}%`}</div>
              )}
              {!uploading && (
                <div className={s.remove} onClick={() => removeFile(index)}/>
              )}
            </div>
          </div>
        )} */}
      </div>
    </div>
  )
}

export default FileUploader
