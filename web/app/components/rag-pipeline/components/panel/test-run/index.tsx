import { useStore as useWorkflowStoreWithSelector } from '@/app/components/workflow/store'
import { RiCloseLine } from '@remixicon/react'
import { useCallback, useMemo, useState } from 'react'
import StepIndicator from './step-indicator'
import { useTestRunSteps } from './hooks'
import DataSourceOptions from './data-source-options'
import type { CrawlOptions, CrawlResultItem, FileItem } from '@/models/datasets'
import { DataSourceType } from '@/models/datasets'
import LocalFile from './data-source/local-file'
import produce from 'immer'
import { useProviderContextSelector } from '@/context/provider-context'
import { DataSourceProvider, type NotionPage } from '@/models/common'
import Notion from './data-source/notion'
import VectorSpaceFull from '@/app/components/billing/vector-space-full'
import { DEFAULT_CRAWL_OPTIONS } from './consts'
import Firecrawl from './data-source/website/firecrawl'
import JinaReader from './data-source/website/jina-reader'
import WaterCrawl from './data-source/website/water-crawl'
import Actions from './data-source/actions'
import DocumentProcessing from './document-processing'
import { useTranslation } from 'react-i18next'
import { useWorkflowRun } from '../../../hooks'
import type { Datasource } from './types'

const TestRunPanel = () => {
  const { t } = useTranslation()
  const setShowDebugAndPreviewPanel = useWorkflowStoreWithSelector(state => state.setShowDebugAndPreviewPanel)
  const [currentStep, setCurrentStep] = useState(1)
  const [datasource, setDatasource] = useState<Datasource>({
    nodeId: '1',
    type: DataSourceType.FILE,
    config: {},
  })
  const [fileList, setFiles] = useState<FileItem[]>([])
  const [notionPages, setNotionPages] = useState<NotionPage[]>([])
  const [websitePages, setWebsitePages] = useState<CrawlResultItem[]>([])
  const [websiteCrawlJobId, setWebsiteCrawlJobId] = useState('')
  const [crawlOptions, setCrawlOptions] = useState<CrawlOptions>(DEFAULT_CRAWL_OPTIONS)

  const plan = useProviderContextSelector(state => state.plan)
  const enableBilling = useProviderContextSelector(state => state.enableBilling)

  const steps = useTestRunSteps()
  // TODO: replace with real data sources from API
  const dataSources = useMemo(() => [{
    nodeId: '1',
    type: DataSourceType.FILE,
    config: {},
  }, {
    nodeId: '2',
    type: DataSourceType.NOTION,
    config: {},
  }, {
    nodeId: '3',
    type: DataSourceProvider.fireCrawl,
    config: {},
  }, {
    nodeId: '4',
    type: DataSourceProvider.jinaReader,
    config: {},
  }, {
    nodeId: '5',
    type: DataSourceProvider.waterCrawl,
    config: {},
  }], [])

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

  const handleClose = () => {
    setShowDebugAndPreviewPanel(false)
  }

  const handleDataSourceSelect = useCallback((option: string) => {
    const dataSource = dataSources.find(dataSource => dataSource.nodeId === option)
    if (!dataSource)
      return
    setDatasource(dataSource)
  }, [dataSources])

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

  const { handleRun } = useWorkflowRun()

  const handleProcess = useCallback((data: Record<string, any>) => {
    const datasourceInfo: Record<string, any> = {}
    if (datasource.type === DataSourceType.FILE)
      datasourceInfo.fileId = fileList.map(file => file.fileID)
    if (datasource.type === DataSourceType.NOTION) {
      datasourceInfo.workspaceId = notionPages[0].workspace_id
      datasourceInfo.page = notionPages.map((page) => {
        const { workspace_id, ...rest } = page
        return rest
      })
    }
    if (datasource.type === DataSourceProvider.fireCrawl
      || datasource.type === DataSourceProvider.jinaReader
      || datasource.type === DataSourceProvider.waterCrawl) {
      datasourceInfo.jobId = websiteCrawlJobId
      datasourceInfo.result = websitePages
    }
    // todo: TBD
    handleRun({
      inputs: data,
      datasource_type: datasource,
      datasource_info: datasourceInfo,
    })
  }, [datasource, fileList, handleRun, notionPages, websiteCrawlJobId, websitePages])

  return (
    <div
      className='relative flex h-full w-[480px] flex-col rounded-l-2xl border-y-[0.5px] border-l-[0.5px] border-components-panel-border bg-components-panel-bg shadow-xl shadow-shadow-shadow-1'
    >
      <button
        type='button'
        className='absolute right-2.5 top-2.5 flex size-8 items-center justify-center p-1.5'
        onClick={handleClose}
      >
        <RiCloseLine className='size-4 text-text-tertiary' />
      </button>
      <div className='flex flex-col gap-y-0.5 px-3 pb-2 pt-3.5'>
        <div className='system-md-semibold-uppercase flex items-center justify-between pl-1 pr-8 text-text-primary'>
          {t('datasetPipeline.testRun.title')}
        </div>
        <StepIndicator steps={steps} currentStep={currentStep} />
      </div>
      <div className='grow overflow-y-auto'>
        {
          currentStep === 1 && (
            <>
              <div className='flex flex-col gap-y-4 px-4 py-2'>
                <DataSourceOptions
                  dataSources={dataSources}
                  dataSourceNodeId={datasource.nodeId}
                  onSelect={handleDataSourceSelect}
                />
                {datasource.type === DataSourceType.FILE && (
                  <LocalFile
                    files={fileList}
                    updateFile={updateFile}
                    updateFileList={updateFileList}
                    notSupportBatchUpload={notSupportBatchUpload}
                  />
                )}
                {datasource.type === DataSourceType.NOTION && (
                  <Notion
                    notionPages={notionPages}
                    updateNotionPages={updateNotionPages}
                  />
                )}
                {datasource.type === DataSourceProvider.fireCrawl && (
                  <Firecrawl
                    checkedCrawlResult={websitePages}
                    onCheckedCrawlResultChange={setWebsitePages}
                    onJobIdChange={setWebsiteCrawlJobId}
                    crawlOptions={crawlOptions}
                    onCrawlOptionsChange={setCrawlOptions}
                  />
                )}
                {datasource.type === DataSourceProvider.jinaReader && (
                  <JinaReader
                    checkedCrawlResult={websitePages}
                    onCheckedCrawlResultChange={setWebsitePages}
                    onJobIdChange={setWebsiteCrawlJobId}
                    crawlOptions={crawlOptions}
                    onCrawlOptionsChange={setCrawlOptions}
                  />
                )}
                {datasource.type === DataSourceProvider.waterCrawl && (
                  <WaterCrawl
                    checkedCrawlResult={websitePages}
                    onCheckedCrawlResultChange={setWebsitePages}
                    onJobIdChange={setWebsiteCrawlJobId}
                    crawlOptions={crawlOptions}
                    onCrawlOptionsChange={setCrawlOptions}
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
