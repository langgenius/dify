'use client'
import type { NotionPage } from '@/models/common'
import { RiCloseLine } from '@remixicon/react'
import * as React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Notion } from '@/app/components/base/icons/src/public/common'
import { Markdown } from '@/app/components/base/markdown'
import { toast } from '@/app/components/base/ui/toast'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { usePreviewOnlineDocument } from '@/service/use-pipeline'
import { formatNumberAbbreviated } from '@/utils/format'
import { useDataSourceStore } from '../data-source/store'
import Loading from './loading'

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
        toast.error(error.message)
      },
    })
  }, [currentPage.page_id])

  return (
    <div className="flex h-full w-full flex-col rounded-t-xl border-t border-l border-components-panel-border bg-background-default-lighter shadow-md shadow-shadow-shadow-5">
      <div className="flex gap-x-2 border-b border-divider-subtle pt-4 pr-4 pb-3 pl-6">
        <div className="flex grow flex-col gap-y-1">
          <div className="system-2xs-semibold-uppercase text-text-accent">{t('addDocuments.stepOne.preview', { ns: 'datasetPipeline' })}</div>
          <div className="text-tex-primary title-md-semi-bold">{currentPage?.page_name}</div>
          <div className="flex items-center gap-x-1 system-xs-medium text-text-tertiary">
            <Notion className="size-3.5" />
            <span>{currentPage.type}</span>
            <span>·</span>
            <span>{`${formatNumberAbbreviated(content.length)} ${t('addDocuments.characters', { ns: 'datasetPipeline' })}`}</span>
          </div>
        </div>
        <button
          type="button"
          className="flex h-8 w-8 shrink-0 items-center justify-center"
          onClick={hidePreview}
        >
          <RiCloseLine className="size-[18px]" />
        </button>
      </div>
      {isPending && (
        <div className="grow">
          <Loading />
        </div>
      )}
      {!isPending && content && (
        <div className="grow overflow-hidden px-6 py-5 body-md-regular text-text-secondary">
          <Markdown content={content} />
        </div>
      )}
    </div>
  )
}

export default OnlineDocumentPreview
