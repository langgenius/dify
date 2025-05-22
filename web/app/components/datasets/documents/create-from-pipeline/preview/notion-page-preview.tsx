'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import type { NotionPage } from '@/models/common'
import { usePreviewNotionPage } from '@/service/knowledge/use-dataset'
import { RiCloseLine } from '@remixicon/react'
import { formatNumberAbbreviated } from '@/utils/format'
import Loading from './loading'
import { Notion } from '@/app/components/base/icons/src/public/common'

type NotionPagePreviewProps = {
  currentPage: NotionPage
  hidePreview: () => void
}

const NotionPagePreview = ({
  currentPage,
  hidePreview,
}: NotionPagePreviewProps) => {
  const { t } = useTranslation()

  const { data: notionPageData, isFetching } = usePreviewNotionPage({
    workspaceID: currentPage.workspace_id,
    pageID: currentPage.page_id,
    pageType: currentPage.type,
  })

  return (
    <div className='h-full rounded-t-xl border-l border-t border-components-panel-border bg-background-default-lighter shadow-md shadow-shadow-shadow-5'>
      <div className='flex gap-x-2 pb-3 pl-6 pr-4 pt-4'>
        <div className='flex grow flex-col gap-y-1'>
          <div className='system-2xs-semibold-uppercase'>{t('datasetPipeline.addDocuments.stepOne.preview')}</div>
          <div className='title-md-semi-bold text-tex-primary'>{currentPage?.page_name}</div>
          <div className='system-xs-medium flex gap-x-1  text-text-tertiary'>
            <Notion className='size-3.5' />
            <span>·</span>
            <span>Notion Page</span>
            <span>·</span>
            {notionPageData && (
              <>
                <span>·</span>
                <span>{`${formatNumberAbbreviated(notionPageData.content.length)} ${t('datasetPipeline.addDocuments.characters')}`}</span>
              </>
            )}
          </div>
        </div>
        <button
          type='button'
          className='flex h-8 w-8 shrink-0 items-center justify-center'
          onClick={hidePreview}
        >
          <RiCloseLine className='size-[18px]' />
        </button>
      </div>
      <div className='px-6 py-5'>
        {isFetching && <Loading />}
        {!isFetching && notionPageData && (
          <div className='body-md-regular overflow-hidden text-text-secondary'>{notionPageData.content}</div>
        )}
      </div>
    </div>
  )
}

export default NotionPagePreview
