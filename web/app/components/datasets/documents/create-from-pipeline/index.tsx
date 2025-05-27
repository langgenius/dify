'use client'
import { useCallback, useMemo, useRef, useState } from 'react'
import DataSourceOptions from './data-source-options'
import type { CrawlResultItem, CustomFile as File, FileIndexingEstimateResponse, FileItem } from '@/models/datasets'
import LocalFile from '@/app/components/rag-pipeline/components/panel/test-run/data-source/local-file'
import produce from 'immer'
import { useProviderContextSelector } from '@/context/provider-context'
import type { NotionPage } from '@/models/common'
import Notion from '@/app/components/rag-pipeline/components/panel/test-run/data-source/notion'
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
import NotionPagePreview from './preview/notion-page-preview'
import WebsitePreview from './preview/web-preview'
import ProcessDocuments from './process-documents'
import ChunkPreview from './preview/chunk-preview'
import Processing from './processing'
import { DatasourceType } from '@/models/pipeline'

const TestRunPanel = () => {
  const { t } = useTranslation()
  const [currentStep, setCurrentStep] = useState(1)
  const [datasource, setDatasource] = useState<Datasource>()
  const [fileList, setFiles] = useState<FileItem[]>([])
  const [notionPages, setNotionPages] = useState<NotionPage[]>([])
  const [websitePages, setWebsitePages] = useState<CrawlResultItem[]>([])
  const [websiteCrawlJobId, setWebsiteCrawlJobId] = useState('')
  const [currentFile, setCurrentFile] = useState<File | undefined>()
  const [currentNotionPage, setCurrentNotionPage] = useState<NotionPage | undefined>()
  const [currentWebsite, setCurrentWebsite] = useState<CrawlResultItem | undefined>()
  const [estimateData, setEstimateData] = useState<FileIndexingEstimateResponse | undefined>(undefined)

  const plan = useProviderContextSelector(state => state.plan)
  const enableBilling = useProviderContextSelector(state => state.enableBilling)
  const datasetId = useDatasetDetailContextWithSelector(s => s.dataset?.id)
  const pipelineId = useDatasetDetailContextWithSelector(s => s.dataset?.pipeline_id)
  const indexingType = useDatasetDetailContextWithSelector(s => s.dataset?.indexing_technique)
  const retrievalMethod = useDatasetDetailContextWithSelector(s => s.dataset?.retrieval_model_dict.search_method)

  const isPreview = useRef(false)
  const formRef = useRef<any>(null)

  const { data: pipelineInfo, isFetching: isFetchingPipelineInfo } = usePublishedPipelineInfo(pipelineId || '')

  const allFileLoaded = (fileList.length > 0 && fileList.every(file => file.file.id))
  const isVectorSpaceFull = plan.usage.vectorSpace >= plan.total.vectorSpace
  const isShowVectorSpaceFull = allFileLoaded && isVectorSpaceFull && enableBilling
  const notSupportBatchUpload = enableBilling && plan.type === 'sandbox'
  const nextDisabled = useMemo(() => {
    if (!fileList.length)
      return true
    if (fileList.some(file => !file.file.id))
      return true
    return isShowVectorSpaceFull
  }, [fileList, isShowVectorSpaceFull])

  const nextBtnDisabled = useMemo(() => {
    if (!datasource) return true
    if (datasource.type === DatasourceType.localFile)
      return nextDisabled
    if (datasource.type === DatasourceType.onlineDocument)
      return isShowVectorSpaceFull || !notionPages.length
    if (datasource.type === DatasourceType.websiteCrawl)
      return isShowVectorSpaceFull || !websitePages.length
    return false
  }, [datasource, nextDisabled, isShowVectorSpaceFull, notionPages.length, websitePages.length])

  const updateFile = (fileItem: FileItem, progress: number, list: FileItem[]) => {
    const newList = produce(list, (draft) => {
      const targetIndex = draft.findIndex(file => file.fileID === fileItem.fileID)
      draft[targetIndex] = {
        ...draft[targetIndex],
        progress,
      }
    })
    setFiles(newList)
  }

  const updateFileList = useCallback((preparedFiles: FileItem[]) => {
    setFiles(preparedFiles)
  }, [])

  const updateNotionPages = useCallback((value: NotionPage[]) => {
    setNotionPages(value)
  }, [])

  const updateCurrentFile = useCallback((file: File) => {
    setCurrentFile(file)
  }, [])

  const hideFilePreview = useCallback(() => {
    setCurrentFile(undefined)
  }, [])

  const updateCurrentPage = useCallback((page: NotionPage) => {
    setCurrentNotionPage(page)
  }, [])

  const hideNotionPagePreview = useCallback(() => {
    setCurrentNotionPage(undefined)
  }, [])

  const updateCurrentWebsite = useCallback((website: CrawlResultItem) => {
    setCurrentWebsite(website)
  }, [])

  const hideWebsitePreview = useCallback(() => {
    setCurrentWebsite(undefined)
  }, [])

  const handleNextStep = useCallback(() => {
    setCurrentStep(preStep => preStep + 1)
  }, [])

  const handleBackStep = useCallback(() => {
    setCurrentStep(preStep => preStep - 1)
  }, [])

  const { mutateAsync: runPublishedPipeline, isIdle, isPending } = useRunPublishedPipeline()

  const handlePreviewChunks = useCallback(async (data: Record<string, any>) => {
    if (!datasource)
      return
    const datasourceInfoList: Record<string, any>[] = []
    if (datasource.type === DatasourceType.localFile) {
      const { id, name, type, size, extension, mime_type } = fileList[0].file
      const documentInfo = {
        upload_file_id: id,
        name,
        type,
        size,
        extension,
        mime_type,
      }
      datasourceInfoList.push(documentInfo)
    }
    if (datasource.type === DatasourceType.onlineDocument) {
      const { workspace_id, ...rest } = notionPages[0]
      const documentInfo = {
        workspace_id,
        page: rest,
      }
      datasourceInfoList.push(documentInfo)
    }
    if (datasource.type === DatasourceType.websiteCrawl) {
      const documentInfo = {
        job_id: websiteCrawlJobId,
        result: websitePages[0],
      }
      datasourceInfoList.push(documentInfo)
    }
    await runPublishedPipeline({
      pipeline_id: pipelineId!,
      inputs: data,
      start_node_id: datasource.nodeId,
      datasource_type: datasource.type,
      datasource_info_list: datasourceInfoList,
      is_preview: true,
    }, {
      onSuccess: (res) => {
        setEstimateData(res as FileIndexingEstimateResponse)
      },
    })
  }, [datasource, fileList, notionPages, pipelineId, runPublishedPipeline, websiteCrawlJobId, websitePages])

  const handleProcess = useCallback(async (data: Record<string, any>) => {
    if (!datasource)
      return
    const datasourceInfoList: Record<string, any>[] = []
    if (datasource.type === DatasourceType.localFile) {
      fileList.forEach((file) => {
        const { id, name, type, size, extension, mime_type } = file.file
        const documentInfo = {
          upload_file_id: id,
          name,
          type,
          size,
          extension,
          mime_type,
        }
        datasourceInfoList.push(documentInfo)
      })
    }
    if (datasource.type === DatasourceType.onlineDocument) {
      notionPages.forEach((page) => {
        const { workspace_id, ...rest } = page
        const documentInfo = {
          workspace_id,
          page: rest,
        }
        datasourceInfoList.push(documentInfo)
      })
    }
    if (datasource.type === DatasourceType.websiteCrawl) {
      const documentInfo = {
        job_id: websiteCrawlJobId,
        result: websitePages,
      }
      datasourceInfoList.push(documentInfo)
    }
    await runPublishedPipeline({
      pipeline_id: pipelineId!,
      inputs: data,
      start_node_id: datasource.nodeId,
      datasource_type: datasource.type,
      datasource_info_list: datasourceInfoList,
    }, {
      onSuccess: () => {
        handleNextStep()
      },
    })
  }, [datasource, fileList, handleNextStep, notionPages, pipelineId, runPublishedPipeline, websiteCrawlJobId, websitePages])

  const onClickProcess = useCallback(() => {
    isPreview.current = false
    formRef.current?.submit()
  }, [])

  const onClickPreview = useCallback(() => {
    isPreview.current = true
    formRef.current?.submit()
  }, [])

  const onClickReset = useCallback(() => {
    formRef.current?.reset()
  }, [])

  const handleSubmit = useCallback((data: Record<string, any>) => {
    isPreview.current ? handlePreviewChunks(data) : handleProcess(data)
  }, [handlePreviewChunks, handleProcess])

  if (isFetchingPipelineInfo) {
    return (
      <Loading type='app' />
    )
  }

  return (
    <div
      className='relative flex h-[calc(100vh-56px)] overflow-x-auto rounded-t-2xl border-t border-effects-highlight bg-background-default-subtle'
    >
      <div className='flex h-full min-w-[760px] flex-1 flex-col px-14'>
        <LeftHeader
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
                  <Notion
                    nodeId={datasource?.nodeId || ''}
                    notionPages={notionPages}
                    updateNotionPages={updateNotionPages}
                    canPreview
                    onPreview={updateCurrentPage}
                  />
                )}
                {datasource?.type === DatasourceType.websiteCrawl && (
                  <WebsiteCrawl
                    nodeId={datasource?.nodeId || ''}
                    variables={datasource?.variables}
                    headerInfo={{
                      title: datasource.description,
                      docTitle: datasource.docTitle || '',
                      docLink: datasource.docLink || '',
                    }}
                    checkedCrawlResult={websitePages}
                    onCheckedCrawlResultChange={setWebsitePages}
                    onJobIdChange={setWebsiteCrawlJobId}
                    onPreview={updateCurrentWebsite}
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
                onReset={onClickReset}
                onBack={handleBackStep}
              />
            )
          }
          {
            currentStep === 3 && (
              <Processing
                datasetId={datasetId!}
                batchId={''}
                documents={[]}
                indexingType={indexingType!}
                retrievalMethod={retrievalMethod!}
              />
            )
          }
        </div>
      </div>
      {/* Preview */}
      {
        currentStep === 1 && (
          <div className='flex h-full w-[752px] shrink-0 pl-2 pt-2'>
            {currentFile && <FilePreview file={currentFile} hidePreview={hideFilePreview} />}
            {currentNotionPage && <NotionPagePreview currentPage={currentNotionPage} hidePreview={hideNotionPagePreview} />}
            {currentWebsite && <WebsitePreview payload={currentWebsite} hidePreview={hideWebsitePreview} />}
          </div>
        )
      }
      {
        currentStep === 2 && (
          <div className='flex h-full w-[752px] shrink-0 pl-2 pt-2'>
            {estimateData && (
              <ChunkPreview
                datasource={datasource!}
                files={fileList.map(file => file.file)}
                notionPages={notionPages}
                websitePages={websitePages}
                isIdle={isIdle}
                isPending={isPending}
                estimateData={estimateData}
                onPreview={onClickPreview}
              />
            )}
          </div>
        )
      }
    </div>
  )
}

export default TestRunPanel
