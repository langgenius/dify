import type { Datasource } from '../types'
import * as React from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { trackEvent } from '@/app/components/base/amplitude'
import LocalFile from '@/app/components/datasets/documents/create-from-pipeline/data-source/local-file'
import OnlineDocuments from '@/app/components/datasets/documents/create-from-pipeline/data-source/online-documents'
import OnlineDrive from '@/app/components/datasets/documents/create-from-pipeline/data-source/online-drive'
import { useDataSourceStore, useDataSourceStoreWithSelector } from '@/app/components/datasets/documents/create-from-pipeline/data-source/store'
import WebsiteCrawl from '@/app/components/datasets/documents/create-from-pipeline/data-source/website-crawl'
import { useWorkflowRun } from '@/app/components/workflow/hooks'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { DatasourceType } from '@/models/pipeline'
import { TransferMethod } from '@/types/app'
import Actions from './actions'
import DataSourceOptions from './data-source-options'
import DocumentProcessing from './document-processing'
import FooterTips from './footer-tips'
import {
  useOnlineDocument,
  useOnlineDrive,
  useTestRunSteps,
  useWebsiteCrawl,
} from './hooks'
import StepIndicator from './step-indicator'

const Preparation = () => {
  const {
    localFileList,
    onlineDocuments,
    websitePages,
    selectedFileIds,
  } = useDataSourceStoreWithSelector(useShallow(state => ({
    localFileList: state.localFileList,
    onlineDocuments: state.onlineDocuments,
    websitePages: state.websitePages,
    selectedFileIds: state.selectedFileIds,
  })))
  const workflowStore = useWorkflowStore()
  const dataSourceStore = useDataSourceStore()
  const [datasource, setDatasource] = useState<Datasource>()

  const {
    steps,
    currentStep,
    handleNextStep,
    handleBackStep,
  } = useTestRunSteps()

  const { clearOnlineDocumentData } = useOnlineDocument()
  const { clearWebsiteCrawlData } = useWebsiteCrawl()
  const { clearOnlineDriveData } = useOnlineDrive()

  const datasourceType = datasource?.nodeData.provider_type

  const nextBtnDisabled = useMemo(() => {
    if (!datasource)
      return true
    if (datasourceType === DatasourceType.localFile)
      return !localFileList.length || localFileList.some(file => !file.file.id)
    if (datasourceType === DatasourceType.onlineDocument)
      return !onlineDocuments.length
    if (datasourceType === DatasourceType.websiteCrawl)
      return !websitePages.length
    if (datasourceType === DatasourceType.onlineDrive)
      return !selectedFileIds.length
    return false
  }, [datasource, datasourceType, localFileList, onlineDocuments.length, selectedFileIds.length, websitePages.length])

  const { handleRun } = useWorkflowRun()

  const handleProcess = useCallback((data: Record<string, any>) => {
    if (!datasource)
      return
    const datasourceInfoList: Record<string, any>[] = []
    const credentialId = dataSourceStore.getState().currentCredentialId
    if (datasourceType === DatasourceType.localFile) {
      const { localFileList } = dataSourceStore.getState()
      const { id, name, type, size, extension, mime_type } = localFileList[0].file
      const documentInfo = {
        related_id: id,
        name,
        type,
        size,
        extension,
        mime_type,
        url: '',
        transfer_method: TransferMethod.local_file,
      }
      datasourceInfoList.push(documentInfo)
    }
    if (datasourceType === DatasourceType.onlineDocument) {
      const { onlineDocuments } = dataSourceStore.getState()
      const { workspace_id, ...rest } = onlineDocuments[0]
      const documentInfo = {
        workspace_id,
        page: rest,
        credential_id: credentialId,
      }
      datasourceInfoList.push(documentInfo)
    }
    if (datasourceType === DatasourceType.websiteCrawl) {
      const { websitePages } = dataSourceStore.getState()
      datasourceInfoList.push({
        ...websitePages[0],
        credential_id: credentialId,
      })
    }
    if (datasourceType === DatasourceType.onlineDrive) {
      const { bucket, onlineDriveFileList, selectedFileIds } = dataSourceStore.getState()
      const file = onlineDriveFileList.find(file => file.id === selectedFileIds[0])
      datasourceInfoList.push({
        bucket,
        id: file?.id,
        name: file?.name,
        type: file?.type,
        credential_id: credentialId,
      })
    }
    const { setIsPreparingDataSource } = workflowStore.getState()
    handleRun({
      inputs: data,
      start_node_id: datasource.nodeId,
      datasource_type: datasourceType,
      datasource_info_list: datasourceInfoList,
    })
    trackEvent('pipeline_start_action_time', { action_type: 'document_processing' })
    setIsPreparingDataSource?.(false)
  }, [dataSourceStore, datasource, datasourceType, handleRun, workflowStore])

  const clearDataSourceData = useCallback((dataSource: Datasource) => {
    if (dataSource.nodeData.provider_type === DatasourceType.onlineDocument)
      clearOnlineDocumentData()
    else if (dataSource.nodeData.provider_type === DatasourceType.websiteCrawl)
      clearWebsiteCrawlData()
    else if (dataSource.nodeData.provider_type === DatasourceType.onlineDrive)
      clearOnlineDriveData()
  }, [clearOnlineDocumentData, clearOnlineDriveData, clearWebsiteCrawlData])

  const handleSwitchDataSource = useCallback((dataSource: Datasource) => {
    const {
      setCurrentCredentialId,
      currentNodeIdRef,
    } = dataSourceStore.getState()
    clearDataSourceData(dataSource)
    setCurrentCredentialId('')
    currentNodeIdRef.current = dataSource.nodeId
    setDatasource(dataSource)
  }, [clearDataSourceData, dataSourceStore])

  const handleCredentialChange = useCallback((credentialId: string) => {
    const { setCurrentCredentialId } = dataSourceStore.getState()
    clearDataSourceData(datasource!)
    setCurrentCredentialId(credentialId)
  }, [clearDataSourceData, dataSourceStore, datasource])
  return (
    <>
      <StepIndicator steps={steps} currentStep={currentStep} />
      <div className="flex grow flex-col overflow-y-auto">
        {
          currentStep === 1 && (
            <>
              <div className="flex flex-col gap-y-4 px-4 py-2">
                <DataSourceOptions
                  dataSourceNodeId={datasource?.nodeId || ''}
                  onSelect={handleSwitchDataSource}
                />
                {datasourceType === DatasourceType.localFile && (
                  <LocalFile
                    allowedExtensions={datasource!.nodeData.fileExtensions || []}
                    supportBatchUpload={false} // only support single file upload in test run
                  />
                )}
                {datasourceType === DatasourceType.onlineDocument && (
                  <OnlineDocuments
                    nodeId={datasource!.nodeId}
                    nodeData={datasource!.nodeData}
                    isInPipeline
                    onCredentialChange={handleCredentialChange}
                    supportBatchUpload={false}
                  />
                )}
                {datasourceType === DatasourceType.websiteCrawl && (
                  <WebsiteCrawl
                    nodeId={datasource!.nodeId}
                    nodeData={datasource!.nodeData}
                    isInPipeline
                    onCredentialChange={handleCredentialChange}
                    supportBatchUpload={false}
                  />
                )}
                {datasourceType === DatasourceType.onlineDrive && (
                  <OnlineDrive
                    nodeId={datasource!.nodeId}
                    nodeData={datasource!.nodeData}
                    isInPipeline
                    onCredentialChange={handleCredentialChange}
                    supportBatchUpload={false}
                  />
                )}
              </div>
              <Actions disabled={nextBtnDisabled} handleNextStep={handleNextStep} />
              <FooterTips />
            </>
          )
        }
        {
          currentStep === 2 && (
            <DocumentProcessing
              dataSourceNodeId={datasource!.nodeId}
              onProcess={handleProcess}
              onBack={handleBackStep}
            />
          )
        }
      </div>
    </>
  )
}

export default React.memo(Preparation)
