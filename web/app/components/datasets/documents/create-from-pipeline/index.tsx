'use client'
import { useCallback, useMemo, useState } from 'react'
// import StepIndicator from './step-indicator'
// import { useTestRunSteps } from './hooks'
// import DataSourceOptions from './data-source-options'
import type { CrawlResultItem, FileItem } from '@/models/datasets'
import { DataSourceType } from '@/models/datasets'
// import LocalFile from './data-source/local-file'
import produce from 'immer'
import { useProviderContextSelector } from '@/context/provider-context'
import { DataSourceProvider, type NotionPage } from '@/models/common'
// import Notion from './data-source/notion'
import VectorSpaceFull from '@/app/components/billing/vector-space-full'
// import Firecrawl from './data-source/website/firecrawl'
// import JinaReader from './data-source/website/jina-reader'
// import WaterCrawl from './data-source/website/water-crawl'
// import Actions from './data-source/actions'
// import DocumentProcessing from './document-processing'
import { useTranslation } from 'react-i18next'
import type { Datasource } from '@/app/components/rag-pipeline/components/panel/test-run/types'
import LocalFile from '@/app/components/rag-pipeline/components/panel/test-run/data-source/local-file'
import Notion from '@/app/components/rag-pipeline/components/panel/test-run/data-source/notion'
import FireCrawl from '@/app/components/rag-pipeline/components/panel/test-run/data-source/website/firecrawl'
import JinaReader from '@/app/components/rag-pipeline/components/panel/test-run/data-source/website/jina-reader'
import WaterCrawl from '@/app/components/rag-pipeline/components/panel/test-run/data-source/website/water-crawl'
import Actions from '@/app/components/rag-pipeline/components/panel/test-run/data-source/actions'
import DocumentProcessing from '@/app/components/rag-pipeline/components/panel/test-run/document-processing'
import LeftHeader from './left-header'
// import { usePipelineRun } from '../../../hooks'
// import type { Datasource } from './types'

const TestRunPanel = () => {
  const { t } = useTranslation()
  const [currentStep, setCurrentStep] = useState(1)
  const [datasource, setDatasource] = useState<Datasource>()
  const [fileList, setFiles] = useState<FileItem[]>([])
  const [notionPages, setNotionPages] = useState<NotionPage[]>([])
  const [websitePages, setWebsitePages] = useState<CrawlResultItem[]>([])
  const [websiteCrawlJobId, setWebsiteCrawlJobId] = useState('')

  const plan = useProviderContextSelector(state => state.plan)
  const enableBilling = useProviderContextSelector(state => state.enableBilling)

  // const steps = useTestRunSteps()

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

  const updateFileList = (preparedFiles: FileItem[]) => {
    setFiles(preparedFiles)
  }

  const updateNotionPages = (value: NotionPage[]) => {
    setNotionPages(value)
  }

  const handleNextStep = useCallback(() => {
    setCurrentStep(preStep => preStep + 1)
  }, [])

  const handleBackStep = useCallback(() => {
    setCurrentStep(preStep => preStep - 1)
  }, [])

  // const { handleRun } = usePipelineRun()

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
    // handleRun({
    //   inputs: data,
    //   datasource_type,
    //   datasource_info: datasourceInfo,
    // })
  }, [datasource, fileList, notionPages, websiteCrawlJobId, websitePages])

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
              <>
                <div className='flex flex-col gap-y-4 px-4 py-2'>
                  {/* <DataSourceOptions
                  datasourceNodeId={datasource?.nodeId || ''}
                  onSelect={setDatasource}
                /> */}
                  {datasource?.type === DataSourceType.FILE && (
                    <LocalFile
                      files={fileList}
                      updateFile={updateFile}
                      updateFileList={updateFileList}
                      notSupportBatchUpload={notSupportBatchUpload}
                    />
                  )}
                  {datasource?.type === DataSourceType.NOTION && (
                    <Notion
                      nodeId={datasource?.nodeId || ''}
                      notionPages={notionPages}
                      updateNotionPages={updateNotionPages}
                    />
                  )}
                  {datasource?.type === DataSourceProvider.fireCrawl && (
                    <FireCrawl
                      nodeId={datasource?.nodeId || ''}
                      variables={datasource?.variables}
                      checkedCrawlResult={websitePages}
                      onCheckedCrawlResultChange={setWebsitePages}
                      onJobIdChange={setWebsiteCrawlJobId}
                    />
                  )}
                  {datasource?.type === DataSourceProvider.jinaReader && (
                    <JinaReader
                      nodeId={datasource?.nodeId || ''}
                      variables={datasource?.variables}
                      checkedCrawlResult={websitePages}
                      onCheckedCrawlResultChange={setWebsitePages}
                      onJobIdChange={setWebsiteCrawlJobId}
                    />
                  )}
                  {datasource?.type === DataSourceProvider.waterCrawl && (
                    <WaterCrawl
                      nodeId={datasource?.nodeId || ''}
                      variables={datasource?.variables}
                      checkedCrawlResult={websitePages}
                      onCheckedCrawlResultChange={setWebsitePages}
                      onJobIdChange={setWebsiteCrawlJobId}
                    />
                  )}
                  {isShowVectorSpaceFull && (
                    <VectorSpaceFull />
                  )}
                </div>
                <Actions disabled={nextBtnDisabled} handleNextStep={handleNextStep} />
              </>
            )
          }
          {
            currentStep === 2 && (
              <DocumentProcessing
                dataSourceNodeId={datasource?.nodeId || ''}
                onProcess={handleProcess}
                onBack={handleBackStep}
              />
            )
          }
        </div>
      </div>
      {/* Preview */}
      <div className='flex h-full flex-1 shrink-0 flex-col pl-2 pt-2'>
      </div>
    </div>
  )
}

export default TestRunPanel
