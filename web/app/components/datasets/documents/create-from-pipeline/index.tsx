'use client'
import { useCallback, useMemo, useState } from 'react'
import DataSourceOptions from './data-source-options'
import type { CrawlResultItem, CustomFile as File, FileItem } from '@/models/datasets'
import { DataSourceType } from '@/models/datasets'
import LocalFile from '@/app/components/rag-pipeline/components/panel/test-run/data-source/local-file'
import produce from 'immer'
import { useProviderContextSelector } from '@/context/provider-context'
import { DataSourceProvider, type NotionPage } from '@/models/common'
import Notion from '@/app/components/rag-pipeline/components/panel/test-run/data-source/notion'
import VectorSpaceFull from '@/app/components/billing/vector-space-full'
import FireCrawl from '@/app/components/rag-pipeline/components/panel/test-run/data-source/website/firecrawl'
import JinaReader from '@/app/components/rag-pipeline/components/panel/test-run/data-source/website/jina-reader'
import WaterCrawl from '@/app/components/rag-pipeline/components/panel/test-run/data-source/website/water-crawl'
import Actions from './data-source/actions'
import { useTranslation } from 'react-i18next'
import type { Datasource } from '@/app/components/rag-pipeline/components/panel/test-run/types'
import LeftHeader from './left-header'
import { usePublishedPipelineInfo } from '@/service/use-pipeline'
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

const TestRunPanel = () => {
  const { t } = useTranslation()
  const [currentStep, setCurrentStep] = useState(3)
  const [datasource, setDatasource] = useState<Datasource>()
  const [fileList, setFiles] = useState<FileItem[]>([])
  const [notionPages, setNotionPages] = useState<NotionPage[]>([])
  const [websitePages, setWebsitePages] = useState<CrawlResultItem[]>([])
  const [websiteCrawlJobId, setWebsiteCrawlJobId] = useState('')
  const [currentFile, setCurrentFile] = useState<File | undefined>()
  const [currentNotionPage, setCurrentNotionPage] = useState<NotionPage | undefined>()
  const [currentWebsite, setCurrentWebsite] = useState<CrawlResultItem | undefined>()

  const plan = useProviderContextSelector(state => state.plan)
  const enableBilling = useProviderContextSelector(state => state.enableBilling)
  const datasetId = useDatasetDetailContextWithSelector(s => s.dataset?.id)
  const pipelineId = useDatasetDetailContextWithSelector(s => s.dataset?.pipeline_id)
  const indexingType = useDatasetDetailContextWithSelector(s => s.dataset?.indexing_technique)
  const retrievalMethod = useDatasetDetailContextWithSelector(s => s.dataset?.retrieval_model_dict.search_method)

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
    if (datasource.type === DataSourceType.FILE)
      return nextDisabled
    if (datasource.type === DataSourceType.NOTION)
      return isShowVectorSpaceFull || !notionPages.length
    if (datasource.type === DataSourceProvider.fireCrawl
      || datasource.type === DataSourceProvider.jinaReader
      || datasource.type === DataSourceProvider.waterCrawl)
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

  const handlePreviewChunks = useCallback((data: Record<string, any>) => {
    console.log(data)
  }, [])

  const handleProcess = useCallback((data: Record<string, any>) => {
    if (!datasource)
      return
    const datasourceInfo: Record<string, any> = {}
    let datasource_type = ''
    if (datasource.type === DataSourceType.FILE) {
      datasource_type = 'local_file'
      datasourceInfo.fileId = fileList.map(file => file.fileID)
    }
    if (datasource.type === DataSourceType.NOTION) {
      datasource_type = 'online_document'
      datasourceInfo.workspaceId = notionPages[0].workspace_id
      datasourceInfo.page = notionPages.map((page) => {
        const { workspace_id, ...rest } = page
        return rest
      })
    }
    if (datasource.type === DataSourceProvider.fireCrawl
      || datasource.type === DataSourceProvider.jinaReader
      || datasource.type === DataSourceProvider.waterCrawl) {
      datasource_type = 'website_crawl'
      datasourceInfo.jobId = websiteCrawlJobId
      datasourceInfo.result = websitePages
    }
    // todo: Run Pipeline
    console.log('datasource_type', datasource_type)
    handleNextStep()
  }, [datasource, fileList, handleNextStep, notionPages, websiteCrawlJobId, websitePages])

  if (isFetchingPipelineInfo) {
    return (
      <Loading type='app' />
    )
  }

  return (
    <div
      className='relative flex h-[calc(100vh-56px)] min-w-[1512px] rounded-t-2xl border-t border-effects-highlight bg-background-default-subtle'
    >
      <div className='flex flex-1 flex-col px-14'>
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
                {datasource?.type === DataSourceType.FILE && (
                  <LocalFile
                    files={fileList}
                    updateFile={updateFile}
                    updateFileList={updateFileList}
                    onPreview={updateCurrentFile}
                    notSupportBatchUpload={notSupportBatchUpload}
                  />
                )}
                {datasource?.type === DataSourceType.NOTION && (
                  <Notion
                    nodeId={datasource?.nodeId || ''}
                    notionPages={notionPages}
                    updateNotionPages={updateNotionPages}
                    canPreview
                    onPreview={updateCurrentPage}
                  />
                )}
                {datasource?.type === DataSourceProvider.fireCrawl && (
                  <FireCrawl
                    nodeId={datasource?.nodeId || ''}
                    variables={datasource?.variables}
                    checkedCrawlResult={websitePages}
                    onCheckedCrawlResultChange={setWebsitePages}
                    onJobIdChange={setWebsiteCrawlJobId}
                    onPreview={updateCurrentWebsite}
                  />
                )}
                {datasource?.type === DataSourceProvider.jinaReader && (
                  <JinaReader
                    nodeId={datasource?.nodeId || ''}
                    variables={datasource?.variables}
                    checkedCrawlResult={websitePages}
                    onCheckedCrawlResultChange={setWebsitePages}
                    onJobIdChange={setWebsiteCrawlJobId}
                    onPreview={updateCurrentWebsite}
                  />
                )}
                {datasource?.type === DataSourceProvider.waterCrawl && (
                  <WaterCrawl
                    nodeId={datasource?.nodeId || ''}
                    variables={datasource?.variables}
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
                dataSourceNodeId={datasource?.nodeId || ''}
                onProcess={handleProcess}
                onPreview={handlePreviewChunks}
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
          <div className='flex h-full flex-1 shrink-0 flex-col pl-2 pt-2'>
            {currentFile && <FilePreview file={currentFile} hidePreview={hideFilePreview} />}
            {currentNotionPage && <NotionPagePreview currentPage={currentNotionPage} hidePreview={hideNotionPagePreview} />}
            {currentWebsite && <WebsitePreview payload={currentWebsite} hidePreview={hideWebsitePreview} />}
          </div>
        )
      }
      {
        currentStep === 2 && (
          <ChunkPreview
            datasource={datasource!}
            files={fileList.map(file => file.file)}
            notionPages={notionPages}
            websitePages={websitePages}
            isIdle={true}
            isPending={true}
            estimateData={undefined}
          />
        )
      }
    </div>
  )
}

export default TestRunPanel
