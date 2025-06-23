'use client'
import { useCallback, useMemo, useRef, useState } from 'react'
import DataSourceOptions from './data-source-options'
import type { CrawlResultItem, DocumentItem, CustomFile as File, FileIndexingEstimateResponse } from '@/models/datasets'
import LocalFile from '@/app/components/rag-pipeline/components/panel/test-run/data-source/local-file'
import { useProviderContextSelector } from '@/context/provider-context'
import type { NotionPage } from '@/models/common'
import OnlineDocuments from '@/app/components/rag-pipeline/components/panel/test-run/data-source/online-documents'
import VectorSpaceFull from '@/app/components/billing/vector-space-full'
import WebsiteCrawl from '@/app/components/rag-pipeline/components/panel/test-run/data-source/website-crawl'
import Actions from './data-source/actions'
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
import { useAddDocumentsSteps, useLocalFile, useOnlineDocuments, useWebsiteCrawl } from './hooks'

const CreateFormPipeline = () => {
  const { t } = useTranslation()
  const plan = useProviderContextSelector(state => state.plan)
  const enableBilling = useProviderContextSelector(state => state.enableBilling)
  const pipelineId = useDatasetDetailContextWithSelector(s => s.dataset?.pipeline_id)
  const [datasource, setDatasource] = useState<Datasource>()
  const [estimateData, setEstimateData] = useState<FileIndexingEstimateResponse | undefined>(undefined)
  const [batchId, setBatchId] = useState('')
  const [documents, setDocuments] = useState<InitialDocumentDetail[]>([])

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
    previewFile,
    allFileLoaded,
    updateFile,
    updateFileList,
    currentFile,
    updateCurrentFile,
    hideFilePreview,
  } = useLocalFile()
  const {
    onlineDocuments,
    previewOnlineDocument,
    updateOnlineDocuments,
    currentDocuments,
    updateCurrentPage,
    hideOnlineDocumentPreview,
  } = useOnlineDocuments()
  const {
    websitePages,
    crawlResult,
    setCrawlResult,
    step,
    setStep,
    previewWebsitePage,
    updataCheckedCrawlResultChange,
    currentWebsite,
    updateCurrentWebsite,
    previewIndex,
    hideWebsitePreview,
  } = useWebsiteCrawl()

  const isVectorSpaceFull = plan.usage.vectorSpace >= plan.total.vectorSpace
  const isShowVectorSpaceFull = allFileLoaded && isVectorSpaceFull && enableBilling
  const notSupportBatchUpload = enableBilling && plan.type === 'sandbox'

  const nextBtnDisabled = useMemo(() => {
    if (!datasource) return true
    if (datasource.type === DatasourceType.localFile)
      return isShowVectorSpaceFull || !fileList.length || fileList.some(file => !file.file.id)
    if (datasource.type === DatasourceType.onlineDocument)
      return isShowVectorSpaceFull || !onlineDocuments.length
    if (datasource.type === DatasourceType.websiteCrawl)
      return isShowVectorSpaceFull || !websitePages.length
    return false
  }, [datasource, isShowVectorSpaceFull, fileList, onlineDocuments.length, websitePages.length])

  const { mutateAsync: runPublishedPipeline, isIdle, isPending } = useRunPublishedPipeline()

  const handlePreviewChunks = useCallback(async (data: Record<string, any>) => {
    if (!datasource)
      return
    const datasourceInfoList: Record<string, any>[] = []
    if (datasource.type === DatasourceType.localFile) {
      const { id, name, type, size, extension, mime_type } = previewFile.current as File
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
    if (datasource.type === DatasourceType.onlineDocument) {
      const { workspace_id, ...rest } = previewOnlineDocument.current
      const documentInfo = {
        workspace_id,
        page: rest,
      }
      datasourceInfoList.push(documentInfo)
    }
    if (datasource.type === DatasourceType.websiteCrawl)
      datasourceInfoList.push(previewWebsitePage.current)
    await runPublishedPipeline({
      pipeline_id: pipelineId!,
      inputs: data,
      start_node_id: datasource.nodeId,
      datasource_type: datasource.type,
      datasource_info_list: datasourceInfoList,
      is_preview: true,
    }, {
      onSuccess: (res) => {
        setEstimateData((res as PublishedPipelineRunPreviewResponse).data.outputs)
      },
    })
  }, [datasource, pipelineId, previewFile, previewOnlineDocument, previewWebsitePage, runPublishedPipeline])

  const handleProcess = useCallback(async (data: Record<string, any>) => {
    if (!datasource)
      return
    const datasourceInfoList: Record<string, any>[] = []
    if (datasource.type === DatasourceType.localFile) {
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
    if (datasource.type === DatasourceType.onlineDocument) {
      onlineDocuments.forEach((page) => {
        const { workspace_id, ...rest } = page
        const documentInfo = {
          workspace_id,
          page: rest,
        }
        datasourceInfoList.push(documentInfo)
      })
    }
    if (datasource.type === DatasourceType.websiteCrawl) {
      websitePages.forEach((websitePage) => {
        datasourceInfoList.push(websitePage)
      })
    }
    await runPublishedPipeline({
      pipeline_id: pipelineId!,
      inputs: data,
      start_node_id: datasource.nodeId,
      datasource_type: datasource.type,
      datasource_info_list: datasourceInfoList,
      is_preview: false,
    }, {
      onSuccess: (res) => {
        setBatchId((res as PublishedPipelineRunResponse).batch || '')
        setDocuments((res as PublishedPipelineRunResponse).documents || [])
        handleNextStep()
      },
    })
  }, [datasource, fileList, handleNextStep, onlineDocuments, pipelineId, runPublishedPipeline, websitePages])

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
    previewFile.current = file
    onClickPreview()
  }, [onClickPreview, previewFile])

  const handlePreviewOnlineDocumentChange = useCallback((page: NotionPage) => {
    previewOnlineDocument.current = page
    onClickPreview()
  }, [onClickPreview, previewOnlineDocument])

  const handlePreviewWebsiteChange = useCallback((website: CrawlResultItem) => {
    previewWebsitePage.current = website
    onClickPreview()
  }, [onClickPreview, previewWebsitePage])

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
                  {datasource?.type === DatasourceType.localFile && (
                    <LocalFile
                      files={fileList}
                      allowedExtensions={datasource?.fileExtensions || []}
                      updateFile={updateFile}
                      updateFileList={updateFileList}
                      onPreview={updateCurrentFile}
                      notSupportBatchUpload={notSupportBatchUpload}
                    />
                  )}
                  {datasource?.type === DatasourceType.onlineDocument && (
                    <OnlineDocuments
                      nodeId={datasource?.nodeId || ''}
                      headerInfo={{
                        title: datasource.description,
                        docTitle: datasource.docTitle || '',
                        docLink: datasource.docLink || '',
                      }}
                      onlineDocuments={onlineDocuments}
                      updateOnlineDocuments={updateOnlineDocuments}
                      canPreview
                      onPreview={updateCurrentPage}
                    />
                  )}
                  {datasource?.type === DatasourceType.websiteCrawl && (
                    <WebsiteCrawl
                      nodeId={datasource?.nodeId || ''}
                      headerInfo={{
                        title: datasource.description,
                        docTitle: datasource.docTitle || '',
                        docLink: datasource.docLink || '',
                      }}
                      crawlResult={crawlResult}
                      setCrawlResult={setCrawlResult}
                      step={step}
                      setStep={setStep}
                      checkedCrawlResult={websitePages}
                      onCheckedCrawlResultChange={updataCheckedCrawlResultChange}
                      onPreview={updateCurrentWebsite}
                      previewIndex={previewIndex}
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
                  dataSourceNodeId={datasource?.nodeId || ''}
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
              {currentFile && <FilePreview file={currentFile} hidePreview={hideFilePreview} />}
              {currentDocuments && <OnlineDocumentPreview currentPage={currentDocuments} hidePreview={hideOnlineDocumentPreview} />}
              {currentWebsite && <WebsitePreview payload={currentWebsite} hidePreview={hideWebsitePreview} />}
            </div>
          </div>
        )
      }
      {
        currentStep === 2 && (
          <div className='h-full min-w-0 flex-1'>
            <div className='flex h-full flex-col pl-2 pt-2'>
              <ChunkPreview
                dataSourceType={datasource!.type}
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

export default CreateFormPipeline
