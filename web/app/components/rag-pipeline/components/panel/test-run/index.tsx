import { useStore } from '@/app/components/workflow/store'
import { RiCloseLine } from '@remixicon/react'
import { useCallback, useMemo, useState } from 'react'
import StepIndicator from './step-indicator'
import { useTestRunSteps } from './hooks'
import DataSourceOptions from './data-source-options'
import type { CrawlOptions, CrawlResultItem, FileItem } from '@/models/datasets'
import { DataSourceType } from '@/models/datasets'
import LocalFile from './data-source/local-file'
import produce from 'immer'
import Button from '@/app/components/base/button'
import { useTranslation } from 'react-i18next'
import { useProviderContextSelector } from '@/context/provider-context'
import { DataSourceProvider, type NotionPage } from '@/models/common'
import Notion from './data-source/notion'
import VectorSpaceFull from '@/app/components/billing/vector-space-full'
import { DEFAULT_CRAWL_OPTIONS } from './consts'
import Firecrawl from './data-source/website/firecrawl'
import JinaReader from './data-source/website/jina-reader'
import WaterCrawl from './data-source/website/water-crawl'

const TestRunPanel = () => {
  const { t } = useTranslation()
  const [currentStep, setCurrentStep] = useState(1)
  const [dataSource, setDataSource] = useState<string>(DataSourceProvider.waterCrawl)
  const [fileList, setFiles] = useState<FileItem[]>([])
  const [notionPages, setNotionPages] = useState<NotionPage[]>([])
  const [websitePages, setWebsitePages] = useState<CrawlResultItem[]>([])
  const [websiteCrawlJobId, setWebsiteCrawlJobId] = useState('')
  const [crawlOptions, setCrawlOptions] = useState<CrawlOptions>(DEFAULT_CRAWL_OPTIONS)

  const setShowTestRunPanel = useStore(s => s.setShowTestRunPanel)
  const plan = useProviderContextSelector(state => state.plan)
  const enableBilling = useProviderContextSelector(state => state.enableBilling)

  const steps = useTestRunSteps()
  const dataSources = ['upload_file', 'notion_import', 'firecrawl', 'jinareader', 'watercrawl'] // TODO: replace with real data sources from API

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
    if (dataSource === DataSourceType.FILE)
      return nextDisabled
    if (dataSource === DataSourceType.NOTION)
      return isShowVectorSpaceFull || !notionPages.length
    if (dataSource === DataSourceProvider.fireCrawl
      || dataSource === DataSourceProvider.jinaReader
      || dataSource === DataSourceProvider.waterCrawl)
      return isShowVectorSpaceFull || !websitePages.length
    return false
  }, [dataSource, nextDisabled, isShowVectorSpaceFull, notionPages.length, websitePages.length])

  const handleClose = () => {
    setShowTestRunPanel?.(false)
  }

  const handleDataSourceSelect = useCallback((option: string) => {
    setDataSource(option)
  }, [])

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
          TEST RUN
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
                  dataSourceType={dataSource}
                  onSelect={handleDataSourceSelect}
                />
                {dataSource === DataSourceType.FILE && (
                  <LocalFile
                    files={fileList}
                    updateFile={updateFile}
                    updateFileList={updateFileList}
                    notSupportBatchUpload={notSupportBatchUpload}
                  />
                )}
                {dataSource === DataSourceType.NOTION && (
                  <Notion
                    notionPages={notionPages}
                    updateNotionPages={updateNotionPages}
                  />
                )}
                {dataSource === DataSourceProvider.fireCrawl && (
                  <Firecrawl
                    checkedCrawlResult={websitePages}
                    onCheckedCrawlResultChange={setWebsitePages}
                    onJobIdChange={setWebsiteCrawlJobId}
                    crawlOptions={crawlOptions}
                    onCrawlOptionsChange={setCrawlOptions}
                  />
                )}
                {dataSource === DataSourceProvider.jinaReader && (
                  <JinaReader
                    checkedCrawlResult={websitePages}
                    onCheckedCrawlResultChange={setWebsitePages}
                    onJobIdChange={setWebsiteCrawlJobId}
                    crawlOptions={crawlOptions}
                    onCrawlOptionsChange={setCrawlOptions}
                  />
                )}
                {dataSource === DataSourceProvider.waterCrawl && (
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
              <div className='flex justify-end p-4 pt-2'>
                <Button disabled={nextBtnDisabled} variant='primary' onClick={handleNextStep}>
                  <span className='px-0.5'>{t('datasetCreation.stepOne.button')}</span>
                </Button>
              </div>
            </>
          )
        }
      </div>
    </div>
  )
}

export default TestRunPanel
