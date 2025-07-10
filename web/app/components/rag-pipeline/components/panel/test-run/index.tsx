import { useStore as useWorkflowStoreWithSelector } from '@/app/components/workflow/store'
import { useCallback, useMemo, useState } from 'react'
import { useTestRunSteps } from './hooks'
import DataSourceOptions from './data-source-options'
import LocalFile from '@/app/components/datasets/documents/create-from-pipeline/data-source/local-file'
import OnlineDocuments from '@/app/components/datasets/documents/create-from-pipeline/data-source/online-documents'
import WebsiteCrawl from '@/app/components/datasets/documents/create-from-pipeline/data-source/website-crawl'
import OnlineDrive from '@/app/components/datasets/documents/create-from-pipeline/data-source/online-drive'
import Actions from './actions'
import DocumentProcessing from './document-processing'
import { useWorkflowRun } from '@/app/components/workflow/hooks'
import type { Datasource } from './types'
import { DatasourceType } from '@/models/pipeline'
import { TransferMethod } from '@/types/app'
import CloseButton from './close-button'
import Header from './header'
import FooterTips from './footer-tips'
import DataSourceProvider from '@/app/components/datasets/documents/create-from-pipeline/data-source/store/provider'
import { useDataSourceStore, useDataSourceStoreWithSelector } from '@/app/components/datasets/documents/create-from-pipeline/data-source/store'

const TestRunPanel = () => {
  const setShowDebugAndPreviewPanel = useWorkflowStoreWithSelector(state => state.setShowDebugAndPreviewPanel)
  const fileList = useDataSourceStoreWithSelector(state => state.localFileList)
  const onlineDocuments = useDataSourceStoreWithSelector(state => state.onlineDocuments)
  const websitePages = useDataSourceStoreWithSelector(state => state.websitePages)
  const selectedFileKeys = useDataSourceStoreWithSelector(state => state.selectedFileKeys)
  const dataSourceStore = useDataSourceStore()
  const [datasource, setDatasource] = useState<Datasource>()

  const {
    steps,
    currentStep,
    handleNextStep,
    handleBackStep,
  } = useTestRunSteps()

  const datasourceType = datasource?.nodeData.provider_type

  const nextBtnDisabled = useMemo(() => {
    if (!datasource) return true
    if (datasourceType === DatasourceType.localFile)
      return !fileList.length || fileList.some(file => !file.file.id)
    if (datasourceType === DatasourceType.onlineDocument)
      return !onlineDocuments.length
    if (datasourceType === DatasourceType.websiteCrawl)
      return !websitePages.length
    if (datasourceType === DatasourceType.onlineDrive)
      return !selectedFileKeys.length
    return false
  }, [datasource, datasourceType, fileList, onlineDocuments.length, selectedFileKeys.length, websitePages.length])

  const handleClose = useCallback(() => {
    setShowDebugAndPreviewPanel(false)
  }, [setShowDebugAndPreviewPanel])

  const { handleRun } = useWorkflowRun()

  const handleProcess = useCallback((data: Record<string, any>) => {
    if (!datasource)
      return
    const datasourceInfoList: Record<string, any>[] = []
    if (datasourceType === DatasourceType.localFile) {
      const { id, name, type, size, extension, mime_type } = fileList[0].file
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
      const { workspace_id, ...rest } = onlineDocuments[0]
      const documentInfo = {
        workspace_id,
        page: rest,
      }
      datasourceInfoList.push(documentInfo)
    }
    if (datasourceType === DatasourceType.websiteCrawl)
      datasourceInfoList.push(websitePages[0])
    if (datasourceType === DatasourceType.onlineDrive) {
      const { bucket } = dataSourceStore.getState()
      datasourceInfoList.push({
        bucket,
        key: selectedFileKeys[0],
      })
    }
    handleRun({
      inputs: data,
      start_node_id: datasource.nodeId,
      datasource_type: datasourceType,
      datasource_info_list: datasourceInfoList,
    })
  }, [dataSourceStore, datasource, datasourceType, fileList, handleRun, onlineDocuments, selectedFileKeys, websitePages])

  return (
    <div
      className='relative flex h-full w-[480px] flex-col rounded-l-2xl border-y-[0.5px] border-l-[0.5px] border-components-panel-border bg-components-panel-bg shadow-xl shadow-shadow-shadow-1'
    >
      <CloseButton handleClose={handleClose} />
      <Header steps={steps} currentStep={currentStep} />
      <div className='flex grow flex-col overflow-y-auto'>
        {
          currentStep === 1 && (
            <>
              <div className='flex flex-col gap-y-4 px-4 py-2'>
                <DataSourceOptions
                  dataSourceNodeId={datasource?.nodeId || ''}
                  onSelect={setDatasource}
                />
                {datasourceType === DatasourceType.localFile && (
                  <LocalFile
                    allowedExtensions={datasource!.nodeData.fileExtensions || []}
                    notSupportBatchUpload={false} // only support single file upload in test run
                  />
                )}
                {datasourceType === DatasourceType.onlineDocument && (
                  <OnlineDocuments
                    nodeId={datasource!.nodeId}
                    nodeData={datasource!.nodeData}
                    isInPipeline
                  />
                )}
                {datasourceType === DatasourceType.websiteCrawl && (
                  <WebsiteCrawl
                    nodeId={datasource!.nodeId}
                    nodeData={datasource!.nodeData}
                    isInPipeline
                  />
                )}
                {datasourceType === DatasourceType.onlineDrive && (
                  <OnlineDrive
                    nodeId={datasource!.nodeId}
                    nodeData={datasource!.nodeData}
                    isInPipeline
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
    </div>
  )
}

const TestRunPanelWrapper = () => {
  return (
    <DataSourceProvider>
      <TestRunPanel />
    </DataSourceProvider>
  )
}

export default TestRunPanelWrapper
