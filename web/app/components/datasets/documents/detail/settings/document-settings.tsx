import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useBoolean } from 'ahooks'
import { useContext } from 'use-context-selector'
import { useRouter } from 'next/navigation'
import DatasetDetailContext from '@/context/dataset-detail'
import type {
  CrawlOptions,
  CustomFile,
  DataSourceInfo,
  DataSourceType,
  LegacyDataSourceInfo,
  LocalFileInfo,
  OnlineDocumentInfo,
  WebsiteCrawlInfo,
} from '@/models/datasets'
import type { DataSourceProvider } from '@/models/common'
import Loading from '@/app/components/base/loading'
import StepTwo from '@/app/components/datasets/create/step-two'
import AccountSetting from '@/app/components/header/account-setting'
import AppUnavailable from '@/app/components/base/app-unavailable'
import { useDefaultModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { NotionPage } from '@/models/common'
import { useDocumentDetail, useInvalidDocumentDetail, useInvalidDocumentList } from '@/service/knowledge/use-document'

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

  const invalidDocumentList = useInvalidDocumentList(datasetId)
  const invalidDocumentDetail = useInvalidDocumentDetail()
  const saveHandler = () => {
    invalidDocumentList()
    invalidDocumentDetail()
    router.push(`/datasets/${datasetId}/documents/${documentId}`)
  }

  const cancelHandler = () => router.back()

  const { data: documentDetail, error } = useDocumentDetail({
    datasetId,
    documentId,
    params: { metadata: 'without' },
  })

  const dataSourceInfo = documentDetail?.data_source_info

  const isLegacyDataSourceInfo = (info: DataSourceInfo | undefined): info is LegacyDataSourceInfo => {
    return !!info && 'upload_file' in info
  }
  const isWebsiteCrawlInfo = (info: DataSourceInfo | undefined): info is WebsiteCrawlInfo => {
    return !!info && 'source_url' in info && 'title' in info
  }
  const isOnlineDocumentInfo = (info: DataSourceInfo | undefined): info is OnlineDocumentInfo => {
    return !!info && 'page' in info
  }
  const isLocalFileInfo = (info: DataSourceInfo | undefined): info is LocalFileInfo => {
    return !!info && 'related_id' in info && 'transfer_method' in info
  }
  const legacyInfo = isLegacyDataSourceInfo(dataSourceInfo) ? dataSourceInfo : undefined
  const websiteInfo = isWebsiteCrawlInfo(dataSourceInfo) ? dataSourceInfo : undefined
  const onlineDocumentInfo = isOnlineDocumentInfo(dataSourceInfo) ? dataSourceInfo : undefined
  const localFileInfo = isLocalFileInfo(dataSourceInfo) ? dataSourceInfo : undefined

  const currentPage = useMemo(() => {
    if (legacyInfo) {
      return {
        workspace_id: legacyInfo.notion_workspace_id ?? '',
        page_id: legacyInfo.notion_page_id ?? '',
        page_name: documentDetail?.name,
        page_icon: legacyInfo.notion_page_icon,
        type: documentDetail?.data_source_type,
      }
    }
    if (onlineDocumentInfo) {
      return {
        workspace_id: onlineDocumentInfo.workspace_id,
        page_id: onlineDocumentInfo.page.page_id,
        page_name: onlineDocumentInfo.page.page_name,
        page_icon: onlineDocumentInfo.page.page_icon,
        type: onlineDocumentInfo.page.type,
      }
    }
    return undefined
  }, [documentDetail?.data_source_type, documentDetail?.name, legacyInfo, onlineDocumentInfo])

  const files = useMemo<CustomFile[]>(() => {
    if (legacyInfo?.upload_file)
      return [legacyInfo.upload_file as CustomFile]
    if (localFileInfo) {
      const { related_id, name, extension } = localFileInfo
      return [{
        id: related_id,
        name,
        extension,
      } as unknown as CustomFile]
    }
    return []
  }, [legacyInfo?.upload_file, localFileInfo])

  const websitePages = useMemo(() => {
    if (!websiteInfo)
      return []
    return [{
      title: websiteInfo.title,
      source_url: websiteInfo.source_url,
      content: websiteInfo.content,
      description: websiteInfo.description,
    }]
  }, [websiteInfo])

  const crawlOptions = (dataSourceInfo && typeof dataSourceInfo === 'object' && 'includes' in dataSourceInfo && 'excludes' in dataSourceInfo)
    ? dataSourceInfo as unknown as CrawlOptions
    : undefined

  const websiteCrawlProvider = (websiteInfo?.provider ?? legacyInfo?.provider) as DataSourceProvider | undefined
  const websiteCrawlJobId = websiteInfo?.job_id ?? legacyInfo?.job_id

  if (error)
    return <AppUnavailable code={500} unknownReason={t('datasetCreation.error.unavailable') as string} />

  return (
    <div className='flex' style={{ height: 'calc(100vh - 56px)' }}>
      <div className='grow'>
        {!documentDetail && <Loading type='app' />}
        {dataset && documentDetail && (
          <StepTwo
            isAPIKeySet={!!embeddingsDefaultModel}
            onSetting={showSetAPIKey}
            datasetId={datasetId}
            dataSourceType={documentDetail.data_source_type as DataSourceType}
            notionPages={currentPage ? [currentPage as unknown as NotionPage] : []}
            notionCredentialId={legacyInfo?.credential_id || onlineDocumentInfo?.credential_id || ''}
            websitePages={websitePages}
            websiteCrawlProvider={websiteCrawlProvider}
            websiteCrawlJobId={websiteCrawlJobId || ''}
            crawlOptions={crawlOptions}
            indexingType={indexingTechnique}
            isSetting
            documentDetail={documentDetail}
            files={files}
            onSave={saveHandler}
            onCancel={cancelHandler}
          />
        )}
      </div>
      {isShowSetAPIKey && <AccountSetting activeTab='provider' onCancel={async () => {
        hideSetAPIkey()
      }} />}
    </div>
  )
}

export default DocumentSettings
