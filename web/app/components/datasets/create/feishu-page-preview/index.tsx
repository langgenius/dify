'use client'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import { XMarkIcon } from '@heroicons/react/20/solid'
import s from './index.module.css'
import type { FeishuPage } from '@/models/common'
import FeishuIcon from '@/app/components/base/notion-icon'
import { fetchFeishuPagePreview } from '@/service/datasets'

type IProps = {
  currentPage?: FeishuPage
  hidePreview: () => void
}

const FeishuPagePreview = ({
  currentPage,
  hidePreview,
}: IProps) => {
  const { t } = useTranslation()
  const [previewContent, setPreviewContent] = useState('')
  const [loading, setLoading] = useState(true)

  const getPreviewContent = async () => {
    if (!currentPage)
      return
    try {
      const res = await fetchFeishuPagePreview({
        workspaceID: currentPage.workspace_id,
        objectToken: currentPage.obj_token,
        objectType: currentPage.obj_type,
      })
      setPreviewContent(res.content)
      setLoading(false)
    }
    catch {}
  }

  useEffect(() => {
    if (currentPage) {
      setLoading(true)
      getPreviewContent()
    }
  }, [currentPage])

  return (
    <div className={cn(s.filePreview)}>
      <div className={cn(s.previewHeader)}>
        <div className={cn(s.title)}>
          <span>{t('datasetCreation.stepOne.pagePreview')}</span>
          <div className='flex items-center justify-center w-6 h-6 cursor-pointer' onClick={hidePreview}>
            <XMarkIcon className='h-4 w-4'></XMarkIcon>
          </div>
        </div>
        <div className={cn(s.fileName)}>
          <FeishuIcon
            className='shrink-0 mr-1'
            type='page'
            src={currentPage?.page_icon}
          />
          {currentPage?.page_name}
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

export default FeishuPagePreview
