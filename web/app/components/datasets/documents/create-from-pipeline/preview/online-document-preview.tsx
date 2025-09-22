'use client'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { NotionPage } from '@/models/common'
import { RiCloseLine } from '@remixicon/react'
import { formatNumberAbbreviated } from '@/utils/format'
import Loading from './loading'
import { Notion } from '@/app/components/base/icons/src/public/common'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { usePreviewOnlineDocument } from '@/service/use-pipeline'
import Toast from '@/app/components/base/toast'
import { Markdown } from '@/app/components/base/markdown'
import { useDataSourceStore } from '../data-source/store'

type OnlineDocumentPreviewProps = {
  currentPage: NotionPage
  datasourceNodeId: string
  hidePreview: () => void
}

const OnlineDocumentPreview = ({
  currentPage,
  datasourceNodeId,
  hidePreview,
}: OnlineDocumentPreviewProps) => {
  const { t } = useTranslation()
  const [content, setContent] = useState('')
  const pipelineId = useDatasetDetailContextWithSelector(state => state.dataset?.pipeline_id)
  const { mutateAsync: getOnlineDocumentContent, isPending } = usePreviewOnlineDocument()
  const dataSourceStore = useDataSourceStore()

  useEffect(() => {
    const { currentCredentialId } = dataSourceStore.getState()
    getOnlineDocumentContent({
      workspaceID: currentPage.workspace_id,
      pageID: currentPage.page_id,
      pageType: currentPage.type,
      pipelineId: pipelineId || '',
      datasourceNodeId,
      credentialId: currentCredentialId,
    }, {
      onSuccess(data) {
        setContent(data.content)
      },
      onError(error) {
        Toast.notify({
          type: 'error',
          message: error.message,
        })
      },
    })
  }, [currentPage.page_id])

  return (
    <div className='flex h-full w-full flex-col rounded-t-xl border-l border-t border-components-panel-border bg-background-default-lighter shadow-md shadow-shadow-shadow-5'>
      <div className='flex gap-x-2 border-b border-divider-subtle pb-3 pl-6 pr-4 pt-4'>
        <div className='flex grow flex-col gap-y-1'>
          <div className='system-2xs-semibold-uppercase text-text-accent'>{t('datasetPipeline.addDocuments.stepOne.preview')}</div>
          <div className='title-md-semi-bold text-tex-primary'>{currentPage?.page_name}</div>
          <div className='system-xs-medium flex items-center gap-x-1 text-text-tertiary'>
            <Notion className='size-3.5' />
            <span>{currentPage.type}</span>
            <span>·</span>
            <span>{`${formatNumberAbbreviated(content.length)} ${t('datasetPipeline.addDocuments.characters')}`}</span>
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
      {isPending && (
        <div className='grow'>
          <Loading />
        </div>
      )}
      {!isPending && content && (
        <div className='body-md-regular grow overflow-hidden px-6 py-5 text-text-secondary'>
          <Markdown content={content} />
        </div>
      )}
    </div>
  )
}

export default OnlineDocumentPreview
