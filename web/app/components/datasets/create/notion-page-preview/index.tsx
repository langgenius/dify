'use client'
import type { NotionPage } from '@/models/common'
import { XMarkIcon } from '@heroicons/react/20/solid'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import NotionIcon from '@/app/components/base/notion-icon'
import { fetchNotionPagePreview } from '@/service/datasets'
import s from './index.module.css'

type IProps = {
  currentPage?: NotionPage
  notionCredentialId: string
  hidePreview: () => void
}

const NotionPagePreview = ({
  currentPage,
  notionCredentialId,
  hidePreview,
}: IProps) => {
  const { t } = useTranslation()
  const [previewContent, setPreviewContent] = useState('')
  const [loading, setLoading] = useState(true)

  const getPreviewContent = async () => {
    if (!currentPage)
      return
    try {
      const res = await fetchNotionPagePreview({
        pageID: currentPage.page_id,
        pageType: currentPage.type,
        credentialID: notionCredentialId,
      })
      setPreviewContent(res.content)
      setLoading(false)
    }
    catch { }
  }

  useEffect(() => {
    if (currentPage) {
      setLoading(true)
      getPreviewContent()
    }
  }, [currentPage])

  return (
    <div className={cn(s.filePreview, 'h-full')}>
      <div className={cn(s.previewHeader)}>
        <div className={cn(s.title, 'title-md-semi-bold')}>
          <span>{t('stepOne.pagePreview', { ns: 'datasetCreation' })}</span>
          <button
            type="button"
            className="flex h-6 w-6 cursor-pointer items-center justify-center border-none bg-transparent p-0 focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
            aria-label={t('operation.close', { ns: 'common' })}
            onClick={hidePreview}
          >
            <XMarkIcon className="h-4 w-4" aria-hidden="true"></XMarkIcon>
          </button>
        </div>
        <div className={cn(s.fileName, 'system-xs-medium')}>
          <NotionIcon
            className="mr-1 shrink-0"
            type="page"
            src={currentPage?.page_icon}
          />
          {currentPage?.page_name}
        </div>
      </div>
      <div className={cn(s.previewContent, 'body-md-regular')}>
        {loading && <Loading type="area" />}
        {!loading && (
          <div className={cn(s.fileContent, 'body-md-regular')}>{previewContent}</div>
        )}
      </div>
    </div>
  )
}

export default NotionPagePreview
