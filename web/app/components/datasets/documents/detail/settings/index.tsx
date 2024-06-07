'use client'
import React, { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useBoolean } from 'ahooks'
import { useContext } from 'use-context-selector'
import { useRouter } from 'next/navigation'
import DatasetDetailContext from '@/context/dataset-detail'
import type { FullDocumentDetail } from '@/models/datasets'
import type { MetadataType } from '@/service/datasets'
import { fetchDocumentDetail } from '@/service/datasets'

import Loading from '@/app/components/base/loading'
import StepTwo from '@/app/components/datasets/create/step-two'
import AccountSetting from '@/app/components/header/account-setting'
import AppUnavailable from '@/app/components/base/app-unavailable'
import { useDefaultModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'

type DocumentSettingsProps = {
  datasetId: string
  documentId: string
}

const DocumentSettings = ({ datasetId, documentId }: DocumentSettingsProps) => {
  const { t } = useTranslation()
  const router = useRouter()
  const [isShowSetAPIKey, { setTrue: showSetAPIKey, setFalse: hideSetAPIkey }] = useBoolean()
  const [hasError, setHasError] = useState(false)
  const { indexingTechnique, dataset } = useContext(DatasetDetailContext)
  const { data: embeddingsDefaultModel } = useDefaultModel(ModelTypeEnum.textEmbedding)

  const saveHandler = () => router.push(`/datasets/${datasetId}/documents/${documentId}`)

  const cancelHandler = () => router.back()

  const [documentDetail, setDocumentDetail] = useState<FullDocumentDetail | null>(null)
  const currentPage = useMemo(() => {
    return {
      workspace_id: documentDetail?.data_source_info.notion_workspace_id,
      page_id: documentDetail?.data_source_info.notion_page_id,
      page_name: documentDetail?.name,
      page_icon: documentDetail?.data_source_info.notion_page_icon,
      type: documentDetail?.data_source_info.type,
    }
  }, [documentDetail])
  useEffect(() => {
    (async () => {
      try {
        const detail = await fetchDocumentDetail({
          datasetId,
          documentId,
          params: { metadata: 'without' as MetadataType },
        })
        setDocumentDetail(detail)
      }
      catch (e) {
        setHasError(true)
      }
    })()
  }, [datasetId, documentId])

  if (hasError)
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
            notionPages={[currentPage]}
            indexingType={indexingTechnique || ''}
            isSetting
            documentDetail={documentDetail}
            files={[documentDetail.data_source_info.upload_file]}
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
