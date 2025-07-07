'use client'
import { useCallback, useMemo, useRef, useState } from 'react'
import DataSourceOptions from './data-source-options'
import type { CrawlResultItem, DocumentItem, CustomFile as File, FileIndexingEstimateResponse } from '@/models/datasets'
import LocalFile from '@/app/components/datasets/documents/create-from-pipeline/data-source/local-file'
import { useProviderContextSelector } from '@/context/provider-context'
import type { NotionPage } from '@/models/common'
import OnlineDocuments from '@/app/components/datasets/documents/create-from-pipeline/data-source/online-documents'
import VectorSpaceFull from '@/app/components/billing/vector-space-full'
import WebsiteCrawl from '@/app/components/datasets/documents/create-from-pipeline/data-source/website-crawl'
import OnlineDrive from '@/app/components/datasets/documents/create-from-pipeline/data-source/online-drive'
import Actions from './actions'
import { useTranslation } from 'react-i18next'
import type { Datasource } from '@/app/components/rag-pipeline/components/panel/test-run/types'
import LeftHeader from './left-header'
import { usePublishedPipelineInfo, useRunPublishedPipeline } from '@/service/use-pipeline'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import Loading from '@/app/components/base/loading'
import type { Node } from '@/app/components/workflow/types'
import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import FilePreview from './preview/file-preview'
import OnlineDocumentPreview from './preview/online-document-preview'
import WebsitePreview from './preview/web-preview'
import ProcessDocuments from './process-documents'
import ChunkPreview from './preview/chunk-preview'
import Processing from './processing'
import type { InitialDocumentDetail, PublishedPipelineRunPreviewResponse, PublishedPipelineRunResponse } from '@/models/pipeline'
import { DatasourceType } from '@/models/pipeline'
import { TransferMethod } from '@/types/app'
import { useAddDocumentsSteps, useLocalFile, useOnlineDocuments, useOnlineDrive, useWebsiteCrawl } from './hooks'
import DataSourceProvider from './data-source/store/provider'
import { useDataSourceStore } from './data-source/store'

const CreateFormPipeline = () => {
  const { t } = useTranslation()
  const plan = useProviderContextSelector(state => state.plan)
  const enableBilling = useProviderContextSelector(state => state.enableBilling)
  const pipelineId = useDatasetDetailContextWithSelector(s => s.dataset?.pipeline_id)
  const [datasource, setDatasource] = useState<Datasource>()
  const [estimateData, setEstimateData] = useState<FileIndexingEstimateResponse | undefined>(undefined)
  const [batchId, setBatchId] = useState('')
  const [documents, setDocuments] = useState<InitialDocumentDetail[]>([])
  const dataSourceStore = useDataSourceStore()

  const isPreview = useRef(false)
  const formRef = useRef<any>(null)

  const { data: pipelineInfo, isFetching: isFetchingPipelineInfo } = usePublishedPipelineInfo(pipelineId || '')

  const {
    steps,
    currentStep,
    handleNextStep,
    handleBackStep,
  } = useAddDocumentsSteps()
  const {
    fileList,
    previewFileRef,
    allFileLoaded,
    currentLocalFile,
    hidePreviewLocalFile,
  } = useLocalFile()
  const {
    onlineDocuments,
    currentDocument,
    previewOnlineDocumentRef,
    hidePreviewOnlineDocument,
  } = useOnlineDocuments()
  const {
    websitePages,
    previewWebsitePageRef,
    currentWebsite,
    hideWebsitePreview,
  } = useWebsiteCrawl()
  const {
    fileList: onlineDriveFileList,
    selectedFileList,
  } = useOnlineDrive()

  const datasourceType = datasource?.nodeData.provider_type
  const isVectorSpaceFull = plan.usage.vectorSpace >= plan.total.vectorSpace
  const isShowVectorSpaceFull = useMemo(() => {
    if (!datasource)
      return false
    if (datasourceType === DatasourceType.localFile)
      return allFileLoaded && isVectorSpaceFull && enableBilling
    if (datasourceType === DatasourceType.onlineDocument)
      return onlineDocuments.length > 0 && isVectorSpaceFull && enableBilling
    if (datasourceType === DatasourceType.websiteCrawl)
      return websitePages.length > 0 && isVectorSpaceFull && enableBilling
    if (datasourceType === DatasourceType.onlineDrive)
      return onlineDriveFileList.length > 0 && isVectorSpaceFull && enableBilling
    return false
  }, [allFileLoaded, datasource, datasourceType, enableBilling, isVectorSpaceFull, onlineDocuments.length, onlineDriveFileList.length, websitePages.length])
  const notSupportBatchUpload = enableBilling && plan.type === 'sandbox'

  const nextBtnDisabled = useMemo(() => {
    if (!datasource) return true
    if (datasourceType === DatasourceType.localFile)
      return isShowVectorSpaceFull || !fileList.length || !allFileLoaded
    if (datasourceType === DatasourceType.onlineDocument)
      return isShowVectorSpaceFull || !onlineDocuments.length
    if (datasourceType === DatasourceType.websiteCrawl)
      return isShowVectorSpaceFull || !websitePages.length
    if (datasourceType === DatasourceType.onlineDrive)
      return isShowVectorSpaceFull || !onlineDriveFileList.length
    return false
  }, [datasource, datasourceType, isShowVectorSpaceFull, fileList.length, allFileLoaded, onlineDocuments.length, websitePages.length, onlineDriveFileList.length])

  const { mutateAsync: runPublishedPipeline, isIdle, isPending } = useRunPublishedPipeline()

  const handlePreviewChunks = useCallback(async (data: Record<string, any>) => {
    if (!datasource)
      return
    const datasourceInfoList: Record<string, any>[] = []
    if (datasourceType === DatasourceType.localFile) {
      const { id, name, type, size, extension, mime_type } = previewFileRef.current as File
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
      const { workspace_id, ...rest } = previewOnlineDocumentRef.current!
      const documentInfo = {
        workspace_id,
        page: rest,
      }
      datasourceInfoList.push(documentInfo)
    }
    if (datasourceType === DatasourceType.websiteCrawl)
      datasourceInfoList.push(previewWebsitePageRef.current!)
    await runPublishedPipeline({
      pipeline_id: pipelineId!,
      inputs: data,
      start_node_id: datasource.nodeId,
      datasource_type: datasourceType as DatasourceType,
      datasource_info_list: datasourceInfoList,
      is_preview: true,
    }, {
      onSuccess: (res) => {
        setEstimateData((res as PublishedPipelineRunPreviewResponse).data.outputs)
      },
    })
  }, [datasource, datasourceType, previewWebsitePageRef, runPublishedPipeline, pipelineId, previewFileRef, previewOnlineDocumentRef])

  const handleProcess = useCallback(async (data: Record<string, any>) => {
    if (!datasource)
      return
    const datasourceInfoList: Record<string, any>[] = []
    if (datasourceType === DatasourceType.localFile) {
      fileList.forEach((file) => {
        const { id, name, type, size, extension, mime_type } = file.file
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
      })
    }
    if (datasourceType === DatasourceType.onlineDocument) {
      onlineDocuments.forEach((page) => {
        const { workspace_id, ...rest } = page
        const documentInfo = {
          workspace_id,
          page: rest,
        }
        datasourceInfoList.push(documentInfo)
      })
    }
    if (datasourceType === DatasourceType.websiteCrawl) {
      websitePages.forEach((websitePage) => {
        datasourceInfoList.push(websitePage)
      })
    }
    if (datasourceType === DatasourceType.onlineDrive) {
      if (datasourceType === DatasourceType.onlineDrive) {
        const { bucket } = dataSourceStore.getState()
        selectedFileList.forEach((key) => {
          datasourceInfoList.push({
            bucket,
            key,
          })
        })
      }
    }
    await runPublishedPipeline({
      pipeline_id: pipelineId!,
      inputs: data,
      start_node_id: datasource.nodeId,
      datasource_type: datasourceType as DatasourceType,
      datasource_info_list: datasourceInfoList,
      is_preview: false,
    }, {
      onSuccess: (res) => {
        setBatchId((res as PublishedPipelineRunResponse).batch || '')
        setDocuments((res as PublishedPipelineRunResponse).documents || [])
        handleNextStep()
      },
    })
  }, [dataSourceStore, datasource, datasourceType, fileList, handleNextStep, onlineDocuments, pipelineId, runPublishedPipeline, selectedFileList, websitePages])

  const onClickProcess = useCallback(() => {
    isPreview.current = false
    formRef.current?.submit()
  }, [])

  const onClickPreview = useCallback(() => {
    isPreview.current = true
    formRef.current?.submit()
  }, [])

  const handleSubmit = useCallback((data: Record<string, any>) => {
    isPreview.current ? handlePreviewChunks(data) : handleProcess(data)
  }, [handlePreviewChunks, handleProcess])

  const handlePreviewFileChange = useCallback((file: DocumentItem) => {
    previewFileRef.current = file
    onClickPreview()
  }, [onClickPreview, previewFileRef])

  const handlePreviewOnlineDocumentChange = useCallback((page: NotionPage) => {
    previewOnlineDocumentRef.current = page
    onClickPreview()
  }, [onClickPreview, previewOnlineDocumentRef])

  const handlePreviewWebsiteChange = useCallback((website: CrawlResultItem) => {
    previewWebsitePageRef.current = website
    onClickPreview()
  }, [onClickPreview, previewWebsitePageRef])

  if (isFetchingPipelineInfo) {
    return (
      <Loading type='app' />
    )
  }

  return (
    <div
      className='relative flex h-[calc(100vh-56px)] w-full min-w-[1024px] overflow-x-auto rounded-t-2xl border-t border-effects-highlight bg-background-default-subtle'
    >
      <div className='h-full min-w-0 flex-1'>
        <div className='flex h-full flex-col px-14'>
          <LeftHeader
            steps={steps}
            title={t('datasetPipeline.addDocuments.title')}
            currentStep={currentStep}
          />
          <div className='grow overflow-y-auto'>
            {
              currentStep === 1 && (
                <div className='flex flex-col gap-y-5 pt-4'>
                  <DataSourceOptions
                    datasourceNodeId={datasource?.nodeId || ''}
                    onSelect={setDatasource}
                    pipelineNodes={(pipelineInfo?.graph.nodes || []) as Node<DataSourceNodeType>[]}
                  />
                  {datasourceType === DatasourceType.localFile && (
                    <LocalFile
                      allowedExtensions={datasource!.nodeData.fileExtensions || []}
                      notSupportBatchUpload={notSupportBatchUpload}
                    />
                  )}
                  {datasourceType === DatasourceType.onlineDocument && (
                    <OnlineDocuments
                      nodeId={datasource!.nodeId}
                      nodeData={datasource!.nodeData}
                    />
                  )}
                  {datasourceType === DatasourceType.websiteCrawl && (
                    <WebsiteCrawl
                      nodeId={datasource!.nodeId}
                      nodeData={datasource!.nodeData}
                    />
                  )}
                  {datasourceType === DatasourceType.onlineDrive && (
                    <OnlineDrive
                      nodeId={datasource!.nodeId}
                      nodeData={datasource!.nodeData}
                    />
                  )}
                  {isShowVectorSpaceFull && (
                    <VectorSpaceFull />
                  )}
                  <Actions disabled={nextBtnDisabled} handleNextStep={handleNextStep} />
                </div>
              )
            }
            {
              currentStep === 2 && (
                <ProcessDocuments
                  ref={formRef}
                  dataSourceNodeId={datasource!.nodeId}
                  onProcess={onClickProcess}
                  onPreview={onClickPreview}
                  onSubmit={handleSubmit}
                  onBack={handleBackStep}
                />
              )
            }
            {
              currentStep === 3 && (
                <Processing
                  batchId={batchId}
                  documents={documents}
                />
              )
            }
          </div>
        </div>
      </div>
      {/* Preview */}
      {
        currentStep === 1 && (
          <div className='h-full min-w-0 flex-1'>
            <div className='flex h-full flex-col pl-2 pt-2'>
              {currentLocalFile && (
                <FilePreview
                  file={currentLocalFile}
                  hidePreview={hidePreviewLocalFile}
                />
              )}
              {currentDocument && (
                <OnlineDocumentPreview
                  datasourceNodeId={datasource!.nodeId}
                  currentPage={currentDocument}
                  hidePreview={hidePreviewOnlineDocument}
                />
              )}
              {currentWebsite && (
                <WebsitePreview
                  currentWebsite={currentWebsite}
                  hidePreview={hideWebsitePreview}
                />
              )}
            </div>
          </div>
        )
      }
      {
        currentStep === 2 && (
          <div className='h-full min-w-0 flex-1'>
            <div className='flex h-full flex-col pl-2 pt-2'>
              <ChunkPreview
                dataSourceType={datasourceType as DatasourceType}
                files={fileList.map(file => file.file)}
                onlineDocuments={onlineDocuments}
                websitePages={websitePages}
                isIdle={isIdle}
                isPending={isPending && isPreview.current}
                estimateData={estimateData}
                onPreview={onClickPreview}
                handlePreviewFileChange={handlePreviewFileChange}
                handlePreviewOnlineDocumentChange={handlePreviewOnlineDocumentChange}
                handlePreviewWebsitePageChange={handlePreviewWebsiteChange}
              />
            </div>
          </div>
        )
      }
    </div>
  )
}

const CreateFormPipelineWrapper = () => {
  return (
    <DataSourceProvider>
      <CreateFormPipeline />
    </DataSourceProvider>
  )
}

export default CreateFormPipelineWrapper
