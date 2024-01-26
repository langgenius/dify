'use client'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import cn from 'classnames'
import useSWR from 'swr'
import s from './index.module.css'
import type { CustomFile as File, FileItem } from '@/models/datasets'
import { ToastContext } from '@/app/components/base/toast'

import { upload } from '@/service/base'
import { fetchFileUploadConfig } from '@/service/common'
import { fetchSupportFileTypes } from '@/service/datasets'
import I18n from '@/context/i18n'
import { LanguagesSupportedUnderscore, getModelRuntimeSupported } from '@/utils/language'

type IFileUploaderProps = {
  fileList: FileItem[]
  titleClassName?: string
  prepareFileList: (files: FileItem[]) => void
  onFileUpdate: (fileItem: FileItem, progress: number, list: FileItem[]) => void
  onFileListUpdate?: (files: FileItem[]) => void
  onPreview: (file: File) => void
}

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
  const { locale } = useContext(I18n)
  const language = getModelRuntimeSupported(locale)
  const [dragging, setDragging] = useState(false)
  const dropRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<HTMLDivElement>(null)
  const fileUploader = useRef<HTMLInputElement>(null)

  const { data: fileUploadConfigResponse } = useSWR({ url: '/files/upload' }, fetchFileUploadConfig)
  const { data: supportFileTypesResponse } = useSWR({ url: '/files/support-type' }, fetchSupportFileTypes)
  const supportTypes = supportFileTypesResponse?.allowed_extensions || []
  const supportTypesShowNames = (() => {
    let res = [...supportTypes]
    if (res.includes('markdown') && res.includes('md'))
      res = res.filter(item => item !== 'md')

    if (res.includes('pptx') && res.includes('ppt'))
      res = res.filter(item => item !== 'ppt')

    if (res.includes('html') && res.includes('htm'))
      res = res.filter(item => item !== 'htm')

    res = res.map((item) => {
      if (item === 'md')
        return 'markdown'

      if (item === 'pptx')
        return 'ppt'

      if (item === 'htm')
        return 'html'

      if (item === 'xlsx')
        return 'xls'

      if (item === 'docx')
        return 'doc'

      return item
    })
    res = res.map(item => item.toLowerCase())
    res = res.filter((item, index, self) => self.indexOf(item) === index)

    return res.map(item => item.toUpperCase()).join(language !== LanguagesSupportedUnderscore[1] ? ', ' : '、 ')
  })()
  const ACCEPTS = supportTypes.map((ext: string) => `.${ext}`)
  const fileUploadConfig = useMemo(() => fileUploadConfigResponse ?? {
    file_size_limit: 15,
    batch_count_limit: 5,
  }, [fileUploadConfigResponse])

  const fileListRef = useRef<FileItem[]>([])

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

  const isValid = useCallback((file: File) => {
    const { size } = file
    const ext = `.${getFileType(file)}`
    const isValidType = ACCEPTS.includes(ext.toLowerCase())
    if (!isValidType)
      notify({ type: 'error', message: t('datasetCreation.stepOne.uploader.validation.typeError') })

    const isValidSize = size <= fileUploadConfig.file_size_limit * 1024 * 1024
    if (!isValidSize)
      notify({ type: 'error', message: t('datasetCreation.stepOne.uploader.validation.size', { size: fileUploadConfig.file_size_limit }) })

    return isValidType && isValidSize
  }, [fileUploadConfig, notify, t, ACCEPTS])

  const fileUpload = useCallback(async (fileItem: FileItem): Promise<FileItem> => {
    const formData = new FormData()
    formData.append('file', fileItem.file)
    const onProgress = (e: ProgressEvent) => {
      if (e.lengthComputable) {
        const percent = Math.floor(e.loaded / e.total * 100)
        onFileUpdate(fileItem, percent, fileListRef.current)
      }
    }

    const fileListCopy = fileListRef.current
    return upload({
      xhr: new XMLHttpRequest(),
      data: formData,
      onprogress: onProgress,
    })
      .then((res: File) => {
        const completeFile = {
          fileID: fileItem.fileID,
          file: res,
          progress: -1,
        }
        const index = fileListCopy.findIndex(item => item.fileID === fileItem.fileID)
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
  }, [fileListRef, notify, onFileUpdate, t])

  const uploadBatchFiles = useCallback((bFiles: FileItem[]) => {
    bFiles.forEach(bf => (bf.progress = 0))
    return Promise.all(bFiles.map(fileUpload))
  }, [fileUpload])

  const uploadMultipleFiles = useCallback(async (files: FileItem[]) => {
    const batchCountLimit = fileUploadConfig.batch_count_limit
    const length = files.length
    let start = 0
    let end = 0

    while (start < length) {
      if (start + batchCountLimit > length)
        end = length
      else
        end = start + batchCountLimit
      const bFiles = files.slice(start, end)
      await uploadBatchFiles(bFiles)
      start = end
    }
  }, [fileUploadConfig, uploadBatchFiles])

  const initialUpload = useCallback((files: File[]) => {
    if (!files.length)
      return false

    const preparedFiles = files.map((file, index) => ({
      fileID: `file${index}-${Date.now()}`,
      file,
      progress: -1,
    }))
    const newFiles = [...fileListRef.current, ...preparedFiles]
    prepareFileList(newFiles)
    fileListRef.current = newFiles
    uploadMultipleFiles(preparedFiles)
  }, [prepareFileList, uploadMultipleFiles])

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

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragging(false)
    if (!e.dataTransfer)
      return

    const files = [...e.dataTransfer.files] as File[]
    const validFiles = files.filter(isValid)
    initialUpload(validFiles)
  }, [initialUpload, isValid])

  const selectHandle = () => {
    if (fileUploader.current)
      fileUploader.current.click()
  }

  const removeFile = (fileID: string) => {
    if (fileUploader.current)
      fileUploader.current.value = ''

    fileListRef.current = fileListRef.current.filter(item => item.fileID !== fileID)
    onFileListUpdate?.([...fileListRef.current])
  }
  const fileChangeHandle = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])] as File[]
    initialUpload(files.filter(isValid))
  }, [isValid, initialUpload])

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
  }, [handleDrop])

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
        <div className='flex justify-center items-center min-h-6 mb-2'>
          <span className={s.uploadIcon} />
          <span>
            {t('datasetCreation.stepOne.uploader.button')}
            <label className={s.browse} onClick={selectHandle}>{t('datasetCreation.stepOne.uploader.browse')}</label>
          </span>
        </div>
        <div className={s.tip}>{t('datasetCreation.stepOne.uploader.tip', {
          size: fileUploadConfig.file_size_limit,
          supportTypes: supportTypesShowNames,
        })}</div>
        {dragging && <div ref={dragRef} className={s.draggingCover} />}
      </div>
      <div className={s.fileList}>
        {fileList.map((fileItem, index) => (
          <div
            key={`${fileItem.fileID}-${index}`}
            onClick={() => fileItem.file?.id && onPreview(fileItem.file)}
            className={cn(
              s.file,
              fileItem.progress < 100 && s.uploading,
            )}
          >
            {fileItem.progress < 100 && (
              <div className={s.progressbar} style={{ width: `${fileItem.progress}%` }} />
            )}
            <div className={s.fileInfo}>
              <div className={cn(s.fileIcon, s[getFileType(fileItem.file)])} />
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
                }} />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default FileUploader
