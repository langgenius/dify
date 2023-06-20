'use client'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import cn from 'classnames'
import s from './index.module.css'
import type { File as FileEntity } from '@/models/datasets'
import { ToastContext } from '@/app/components/base/toast'

import { upload } from '@/service/base'

type IFileUploaderProps = {
  fileList: any[]
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

const MAX_SIZE = 10 * 1024 * 1024
const BATCH_COUNT = 5

const FileUploader = ({
  fileList,
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
  const uploadPromise = useRef<any>(null)
  const [currentFile, setCurrentFile] = useState<File>()
  const [uploading, setUploading] = useState(false)
  const [percent, setPercent] = useState(0)

  // TODO
  const fileListRef = useRef<any>(null)

  // utils
  const getFileType = (currentFile: File) => {
    if (!currentFile)
      return ''

    const arr = currentFile.name.split('.')
    return arr[arr.length - 1]
  }
  const getFileName = (name: string) => {
    const arr = name.split('.')
    return arr.slice(0, -1).join()
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
  const onProgress = useCallback((e: ProgressEvent) => {
    if (e.lengthComputable) {
      const percent = Math.floor(e.loaded / e.total * 100)
      // updateFileItem
      setPercent(percent)
    }
  }, [setPercent])
  const abort = () => {
    const currentXHR = uploadPromise.current
    currentXHR.abort()
  }
  const fileUpload = async (fileItem: any) => {
    const fileListCopy = fileListRef.current
    const formData = new FormData()
    formData.append('file', fileItem.file)
    const onProgress = (e: ProgressEvent) => {
      if (e.lengthComputable) {
        const percent = Math.floor(e.loaded / e.total * 100)
        onFileUpdate(fileItem, percent, fileListCopy)
      }
    }

    return upload({
      xhr: new XMLHttpRequest(),
      data: formData,
      onprogress: onProgress,
    })
      .then((res: FileEntity) => {
        const completeFile = {
          fileID: fileItem.fileID,
          file: res,
        }
        onFileUpdate(completeFile, 100, fileListCopy)
        return Promise.resolve({ ...completeFile })
      })
      .catch(() => {
        notify({ type: 'error', message: t('datasetCreation.stepOne.uploader.failed') })
        onFileUpdate(fileItem, -2, [...fileListCopy])
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
    prepareFileList(preparedFiles)
    // TODO fix filelist copy
    fileListRef.current = preparedFiles
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
  // TODO
  const handleDrop = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragging(false)
    if (!e.dataTransfer)
      return

    const files = [...e.dataTransfer.files]
    if (files.length > 1) {
      notify({ type: 'error', message: t('datasetCreation.stepOne.uploader.validation.count') })
      return
    }
    // TODO
    // onFileUpdate()
    fileUpload(files[0])
  }

  const selectHandle = () => {
    if (fileUploader.current)
      fileUploader.current.click()
  }

  const removeFile = (index: number) => {
    if (fileUploader.current)
      fileUploader.current.value = ''

    setCurrentFile(undefined)
    fileListRef.current.splice(index, 1)
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
      <div className={s.title}>{t('datasetCreation.stepOne.uploader.title')}</div>
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
            // onClick={() => onPreview(currentFile)}
            className={cn(
              s.file,
              fileItem.progress < 100 && s.uploading,
              // s.active,
            )}
          >
            {fileItem.progress < 100 && (
              <div className={s.progressbar} style={{ width: `${percent}%` }}/>
            )}
            <div className={s.fileInfo}>
              <div className={cn(s.fileIcon, s[getFileType(fileItem.file)])}/>
              <div className={s.filename}>{fileItem.file.name}</div>
              <div className={s.size}>{getFileSize(fileItem.file.size)}</div>
            </div>
            <div className={s.actionWrapper}>
              {fileItem.progress < 100 && (
                <div className={s.percent}>{`${fileItem.progress}%`}</div>
              )}
              {fileItem.progress === 100 && (
                <div className={s.remove} onClick={() => removeFile(index)}/>
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
      {/* TODO */}
      {/* {false && !currentFile && fileList[0] && (
        <div
          // onClick={() => onPreview(currentFile)}
          className={cn(
            s.file,
            uploading && s.uploading,
            s.active,
          )}
        >
          {uploading && (
            <div className={s.progressbar} style={{ width: `${percent}%` }}/>
          )}
          <div className={s.fileInfo}>
            <div className={cn(s.fileIcon, s[getFileType(fileList[0])])}/>
            <div className={s.filename}>{fileList[0].name}</div>
            <div className={s.size}>{getFileSize(fileList[0].size)}</div>
          </div>
          <div className={s.actionWrapper}>
            {uploading && (
              <div className={s.percent}>{`${percent}%`}</div>
            )}
            {!uploading && (
              <div className={s.remove} onClick={removeFile}/>
            )}
          </div>
        </div>
      )} */}
    </div>
  )
}

export default FileUploader
