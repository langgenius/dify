'use client'
import type { FC } from 'react'
import type { CustomRunFormProps } from './types'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import LocalFile from '@/app/components/datasets/documents/create-from-pipeline/data-source/local-file'
import OnlineDocuments from '@/app/components/datasets/documents/create-from-pipeline/data-source/online-documents'
import OnlineDrive from '@/app/components/datasets/documents/create-from-pipeline/data-source/online-drive'
import { useDataSourceStore } from '@/app/components/datasets/documents/create-from-pipeline/data-source/store'
import DataSourceProvider from '@/app/components/datasets/documents/create-from-pipeline/data-source/store/provider'
import WebsiteCrawl from '@/app/components/datasets/documents/create-from-pipeline/data-source/website-crawl'
import { useOnlineDocument, useOnlineDrive, useWebsiteCrawl } from '@/app/components/rag-pipeline/components/panel/test-run/preparation/hooks'
import { DatasourceType } from '@/models/pipeline'
import PanelWrap from '../_base/components/before-run-form/panel-wrap'
import useBeforeRunForm from './hooks/use-before-run-form'

const BeforeRunForm: FC<CustomRunFormProps> = (props) => {
  const {
    nodeId,
    payload,
    onCancel,
  } = props
  const { t } = useTranslation()
  const dataSourceStore = useDataSourceStore()

  const {
    isPending,
    handleRunWithSyncDraft,
    datasourceType,
    datasourceNodeData,
    startRunBtnDisabled,
  } = useBeforeRunForm(props)

  const { clearOnlineDocumentData } = useOnlineDocument()
  const { clearWebsiteCrawlData } = useWebsiteCrawl()
  const { clearOnlineDriveData } = useOnlineDrive()

  const clearDataSourceData = useCallback(() => {
    if (datasourceType === DatasourceType.onlineDocument)
      clearOnlineDocumentData()
    else if (datasourceType === DatasourceType.websiteCrawl)
      clearWebsiteCrawlData()
    else if (datasourceType === DatasourceType.onlineDrive)
      clearOnlineDriveData()
  }, [clearOnlineDocumentData, clearOnlineDriveData, clearWebsiteCrawlData, datasourceType])

  const handleCredentialChange = useCallback((credentialId: string) => {
    const { setCurrentCredentialId } = dataSourceStore.getState()
    clearDataSourceData()
    setCurrentCredentialId(credentialId)
  }, [clearDataSourceData, dataSourceStore])

  return (
    <PanelWrap
      nodeName={payload.title}
      onHide={onCancel}
    >
      <div className="flex flex-col gap-y-5 px-4 pt-4">
        {datasourceType === DatasourceType.localFile && (
          <LocalFile
            allowedExtensions={datasourceNodeData.fileExtensions || []}
            supportBatchUpload={false}
          />
        )}
        {datasourceType === DatasourceType.onlineDocument && (
          <OnlineDocuments
            nodeId={nodeId}
            nodeData={datasourceNodeData}
            isInPipeline
            onCredentialChange={handleCredentialChange}
            supportBatchUpload={false}
          />
        )}
        {datasourceType === DatasourceType.websiteCrawl && (
          <WebsiteCrawl
            nodeId={nodeId}
            nodeData={datasourceNodeData}
            isInPipeline
            onCredentialChange={handleCredentialChange}
            supportBatchUpload={false}
          />
        )}
        {datasourceType === DatasourceType.onlineDrive && (
          <OnlineDrive
            nodeId={nodeId}
            nodeData={datasourceNodeData}
            isInPipeline
            onCredentialChange={handleCredentialChange}
            supportBatchUpload={false}
          />
        )}
        <div className="flex justify-end gap-x-2">
          <Button onClick={onCancel}>
            {t('operation.cancel', { ns: 'common' })}
          </Button>
          <Button
            onClick={handleRunWithSyncDraft}
            variant="primary"
            loading={isPending}
            disabled={isPending || startRunBtnDisabled}
          >
            {t('singleRun.startRun', { ns: 'workflow' })}
          </Button>
        </div>
      </div>
    </PanelWrap>
  )
}

const BeforeRunFormWrapper = (props: CustomRunFormProps) => {
  return (
    <DataSourceProvider>
      <BeforeRunForm {...props} />
    </DataSourceProvider>
  )
}

export default React.memo(BeforeRunFormWrapper)
