'use client'
import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useBoolean } from 'ahooks'
import { useContext } from 'use-context-selector'
import { useRouter } from 'next/navigation'
import DatasetDetailContext from '@/context/dataset-detail'
import type { CrawlOptions, CustomFile } from '@/models/datasets'

import Loading from '@/app/components/base/loading'
import StepTwo from '@/app/components/datasets/create/step-two'
import AccountSetting from '@/app/components/header/account-setting'
import AppUnavailable from '@/app/components/base/app-unavailable'
import { useDefaultModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { NotionPage } from '@/models/common'
import { useDocumentDetail, useInvalidDocumentDetailKey } from '@/service/knowledge/use-document'

type DocumentSettingsProps = {
  datasetId: string
  documentId: string
}

const DocumentSettings = ({ datasetId, documentId }: DocumentSettingsProps) => {
  const { t } = useTranslation()
  const router = useRouter()
  const [isShowSetAPIKey, { setTrue: showSetAPIKey, setFalse: hideSetAPIkey }] = useBoolean()
  const { indexingTechnique, dataset } = useContext(DatasetDetailContext)
  const { data: embeddingsDefaultModel } = useDefaultModel(ModelTypeEnum.textEmbedding)

  const invalidDocumentDetail = useInvalidDocumentDetailKey()
  const saveHandler = () => {
    invalidDocumentDetail()
    router.push(`/datasets/${datasetId}/documents/${documentId}`)
  }

  const cancelHandler = () => router.back()

  const { data: documentDetail, error } = useDocumentDetail({
    datasetId,
    documentId,
    params: { metadata: 'without' },
  })

  const currentPage = useMemo(() => {
    return {
      workspace_id: documentDetail?.data_source_info.notion_workspace_id,
      page_id: documentDetail?.data_source_info.notion_page_id,
      page_name: documentDetail?.name,
      page_icon: documentDetail?.data_source_info.notion_page_icon,
      type: documentDetail?.data_source_type,
    }
  }, [documentDetail])

  if (error)
    return <AppUnavailable code={500} unknownReason={t('datasetCreation.error.unavailable') as string} />

  return (
    <div className='flex' style={{ height: 'calc(100vh - 56px)' }}>
      <div className="grow bg-white">
        {!documentDetail && <Loading type='app' />}
        {dataset && documentDetail && (
          <StepTwo
            isAPIKeySet={!!embeddingsDefaultModel}
            onSetting={showSetAPIKey}
            datasetId={datasetId}
            dataSourceType={documentDetail.data_source_type}
            notionPages={[currentPage as unknown as NotionPage]}
            websitePages={[
              {
                title: documentDetail.name,
                source_url: documentDetail.data_source_info?.url,
                markdown: '',
                description: '',
              },
            ]}
            websiteCrawlProvider={documentDetail.data_source_info?.provider}
            websiteCrawlJobId={documentDetail.data_source_info?.job_id}
            crawlOptions={documentDetail.data_source_info as unknown as CrawlOptions}
            indexingType={indexingTechnique}
            isSetting
            documentDetail={documentDetail}
            files={[documentDetail.data_source_info.upload_file as CustomFile]}
            onSave={saveHandler}
            onCancel={cancelHandler}
          />
        )}
      </div>
      {isShowSetAPIKey && <AccountSetting activeTab="provider" onCancel={async () => {
        hideSetAPIkey()
      }} />}
    </div>
  )
}

export default DocumentSettings
