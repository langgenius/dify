'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import type { CustomRunFormProps, DataSourceNodeType } from './types'
import { DatasourceType } from '@/models/pipeline'
import LocalFile from '@/app/components/datasets/documents/create-from-pipeline/data-source/local-file'
import OnlineDocuments from '@/app/components/datasets/documents/create-from-pipeline/data-source/online-documents'
import WebsiteCrawl from '@/app/components/datasets/documents/create-from-pipeline/data-source/website-crawl'
import OnlineDrive from '@/app/components/datasets/documents/create-from-pipeline/data-source/online-drive'
import { useDataSourceStore } from '@/app/components/datasets/documents/create-from-pipeline/data-source/store'
import { useOnlineDocument, useOnlineDrive, useWebsiteCrawl } from '@/app/components/rag-pipeline/components/panel/test-run/preparation/hooks'
import Button from '@/app/components/base/button'
import { useTranslation } from 'react-i18next'
import DataSourceProvider from '@/app/components/datasets/documents/create-from-pipeline/data-source/store/provider'
import PanelWrap from '../_base/components/before-run-form/panel-wrap'

const BeforeRunForm: FC<CustomRunFormProps> = ({
  nodeId,
  payload,
  onSuccess,
  onCancel,
}) => {
  const { t } = useTranslation()
  const datasourceType = payload.provider_type
  const datasourceNodeData = payload as DataSourceNodeType
  const dataSourceStore = useDataSourceStore()

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
  }, [datasourceType])

  const handleCredentialChange = useCallback((credentialId: string) => {
    const { setCurrentCredentialId } = dataSourceStore.getState()
    clearDataSourceData()
    setCurrentCredentialId(credentialId)
  }, [dataSourceStore])

  const handleRun = useCallback(() => {
    onSuccess()
  }, [onSuccess])

  return (
    <PanelWrap
      nodeName={payload.title}
      onHide={onCancel}
    >
      <div className='flex flex-col gap-y-5 px-4 pt-4'>
        {datasourceType === DatasourceType.localFile && (
          <LocalFile
            allowedExtensions={datasourceNodeData.fileExtensions || []}
            notSupportBatchUpload={false}
          />
        )}
        {datasourceType === DatasourceType.onlineDocument && (
          <OnlineDocuments
            nodeId={nodeId}
            nodeData={datasourceNodeData}
            onCredentialChange={handleCredentialChange}
          />
        )}
        {datasourceType === DatasourceType.websiteCrawl && (
          <WebsiteCrawl
            nodeId={nodeId}
            nodeData={datasourceNodeData}
            onCredentialChange={handleCredentialChange}
          />
        )}
        {datasourceType === DatasourceType.onlineDrive && (
          <OnlineDrive
            nodeId={nodeId}
            nodeData={datasourceNodeData}
            onCredentialChange={handleCredentialChange}
          />
        )}
        <div className='flex justify-end gap-x-2'>
          <Button onClick={onCancel}>{t('common.operation.cancel')}</Button>
          <Button onClick={handleRun} variant='primary'>{t('workflow.singleRun.startRun')}</Button>
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
