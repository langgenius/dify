'use client'
import React, { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { File } from '@/models/datasets'
import { fetchFilePreview } from '@/service/common'

import cn from 'classnames'
import s from './index.module.css'

type IProps = {
  file?: File,
}

const FilePreview = ({
  file,
}: IProps) => {
  const { t } = useTranslation()
  const [previewContent, setPreviewContent] = useState('')
  const [loading, setLoading] = useState(true)

  const getPreviewContent = async (fileID: string) => {
    try {
      const res = await fetchFilePreview({ fileID })
      setPreviewContent(res.content)
      setLoading(false)
    }
    catch {}
  }

  const getFileName = (currentFile?: File) => {
    if (!currentFile) {
      return ''
    }
    const arr = currentFile.name.split('.')
    return arr.slice(0, -1).join()
  }

  useEffect(() => {
    if (file) {
      getPreviewContent(file.id)
    }
  }, [file])

  return (
    <div className={cn(s.filePreview)}>
      <div className={cn(s.previewHeader)}>
        <div className={cn(s.title)}>{t('datasetCreation.stepOne.filePreview')}</div>
        <div className={cn(s.fileName)}>
          <span>{getFileName(file)}</span><span className={cn(s.filetype)}>.{file?.extension}</span>
        </div>
      </div>
      <div className={cn(s.previewContent)}>
        {loading && <div className={cn(s.loading)}/>}
        {!loading && (
          <div className={cn(s.fileContent)}>{previewContent}</div>
        )}
      </div>
    </div>
  )
}

export default FilePreview
