import { useStore as useWorkflowStoreWithSelector } from '@/app/components/workflow/store'
import { useCallback, useMemo, useState } from 'react'
import { useLocalFile, useOnlineDocuments, useTestRunSteps, useWebsiteCrawl } from './hooks'
import DataSourceOptions from './data-source-options'
import LocalFile from './data-source/local-file'
import { useProviderContextSelector } from '@/context/provider-context'
import OnlineDocuments from './data-source/online-documents'
import VectorSpaceFull from '@/app/components/billing/vector-space-full'
import WebsiteCrawl from './data-source/website-crawl'
import Actions from './data-source/actions'
import DocumentProcessing from './document-processing'
import { useWorkflowRun } from '@/app/components/workflow/hooks'
import type { Datasource } from './types'
import { DatasourceType } from '@/models/pipeline'
import { TransferMethod } from '@/types/app'
import CloseButton from './close-button'
import Header from './header'
import FooterTips from './footer-tips'
import OnlineDrive from './data-source/online-drive'

const TestRunPanel = () => {
  const setShowDebugAndPreviewPanel = useWorkflowStoreWithSelector(state => state.setShowDebugAndPreviewPanel)
  const plan = useProviderContextSelector(state => state.plan)
  const enableBilling = useProviderContextSelector(state => state.enableBilling)
  const [datasource, setDatasource] = useState<Datasource>()

  const {
    steps,
    currentStep,
    handleNextStep,
    handleBackStep,
  } = useTestRunSteps()
  const {
    fileList,
    allFileLoaded,
    updateFile,
    updateFileList,
  } = useLocalFile()
  const {
    onlineDocuments,
    updateOnlineDocuments,
  } = useOnlineDocuments()
  const {
    crawlResult,
    setCrawlResult,
    websitePages,
    setWebsitePages,
    step,
    setStep,
  } = useWebsiteCrawl()
  const { handleRun } = useWorkflowRun()

  const isVectorSpaceFull = plan.usage.vectorSpace >= plan.total.vectorSpace
  const isShowVectorSpaceFull = allFileLoaded && isVectorSpaceFull && enableBilling
  const datasourceType = datasource?.nodeData.provider_type

  const nextBtnDisabled = useMemo(() => {
    if (!datasource) return true
    if (datasourceType === DatasourceType.localFile)
      return isShowVectorSpaceFull || !fileList.length || fileList.some(file => !file.file.id)
    if (datasourceType === DatasourceType.onlineDocument)
      return isShowVectorSpaceFull || !onlineDocuments.length
    if (datasourceType === DatasourceType.websiteCrawl)
      return isShowVectorSpaceFull || !websitePages.length
    return false
  }, [datasource, datasourceType, isShowVectorSpaceFull, fileList, onlineDocuments.length, websitePages.length])

  const handleClose = () => {
    setShowDebugAndPreviewPanel(false)
  }

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
    handleRun({
      inputs: data,
      start_node_id: datasource.nodeId,
      datasource_type: datasourceType,
      datasource_info_list: datasourceInfoList,
    })
  }, [datasource, datasourceType, fileList, handleRun, onlineDocuments, websitePages])

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
                    fileList={fileList}
                    allowedExtensions={datasource!.nodeData.fileExtensions || []}
                    prepareFileList={updateFileList}
                    onFileListUpdate={updateFileList}
                    onFileUpdate={updateFile}
                    notSupportBatchUpload={false} // only support single file upload in test run
                  />
                )}
                {datasourceType === DatasourceType.onlineDocument && (
                  <OnlineDocuments
                    nodeId={datasource!.nodeId}
                    nodeData={datasource!.nodeData}
                    pageIdList={onlineDocuments.map(doc => doc.page_id)}
                    onSelect={updateOnlineDocuments}
                    isInPipeline
                  />
                )}
                {datasourceType === DatasourceType.websiteCrawl && (
                  <WebsiteCrawl
                    nodeId={datasource!.nodeId}
                    checkedCrawlResult={websitePages}
                    nodeData={datasource!.nodeData}
                    crawlResult={crawlResult}
                    setCrawlResult={setCrawlResult}
                    step={step}
                    setStep={setStep}
                    onCheckedCrawlResultChange={setWebsitePages}
                    isInPipeline
                  />
                )}
                {datasourceType === DatasourceType.onlineDrive && (
                  <OnlineDrive
                    nodeData={datasource!.nodeData}
                  />
                )
                }
                {isShowVectorSpaceFull && (
                  <VectorSpaceFull />
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

export default TestRunPanel
