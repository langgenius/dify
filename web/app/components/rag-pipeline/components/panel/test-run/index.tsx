import { useStore as useWorkflowStoreWithSelector } from '@/app/components/workflow/store'
import { RiCloseLine } from '@remixicon/react'
import { useCallback, useMemo, useState } from 'react'
import StepIndicator from './step-indicator'
import { useTestRunSteps } from './hooks'
import DataSourceOptions from './data-source-options'
import type { CrawlResultItem, FileItem } from '@/models/datasets'
import LocalFile from './data-source/local-file'
import produce from 'immer'
import { useProviderContextSelector } from '@/context/provider-context'
import type { NotionPage } from '@/models/common'
import Notion from './data-source/notion'
import VectorSpaceFull from '@/app/components/billing/vector-space-full'
import WebsiteCrawl from './data-source/website-crawl'
import Actions from './data-source/actions'
import DocumentProcessing from './document-processing'
import { useTranslation } from 'react-i18next'
import { usePipelineRun } from '../../../hooks'
import type { Datasource } from './types'
import { DatasourceType } from '@/models/pipeline'

const TestRunPanel = () => {
  const { t } = useTranslation()
  const setShowDebugAndPreviewPanel = useWorkflowStoreWithSelector(state => state.setShowDebugAndPreviewPanel)
  const [currentStep, setCurrentStep] = useState(1)
  const [datasource, setDatasource] = useState<Datasource>()
  const [fileList, setFiles] = useState<FileItem[]>([])
  const [notionPages, setNotionPages] = useState<NotionPage[]>([])
  const [websitePages, setWebsitePages] = useState<CrawlResultItem[]>([])
  const [websiteCrawlJobId, setWebsiteCrawlJobId] = useState('')

  const plan = useProviderContextSelector(state => state.plan)
  const enableBilling = useProviderContextSelector(state => state.enableBilling)

  const steps = useTestRunSteps()

  const allFileLoaded = (fileList.length > 0 && fileList.every(file => file.file.id))
  const isVectorSpaceFull = plan.usage.vectorSpace >= plan.total.vectorSpace
  const isShowVectorSpaceFull = allFileLoaded && isVectorSpaceFull && enableBilling
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

  const handleClose = () => {
    setShowDebugAndPreviewPanel(false)
  }

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

  const { handleRun } = usePipelineRun()

  const handleProcess = useCallback((data: Record<string, any>) => {
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
        result: [websitePages[0]],
      }
      datasourceInfoList.push(documentInfo)
    }
    handleRun({
      inputs: data,
      start_node_id: datasource.nodeId,
      datasource_type: datasource.type,
      datasource_info_list: datasourceInfoList,
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
                  datasourceNodeId={datasource?.nodeId || ''}
                  onSelect={setDatasource}
                />
                {datasource?.type === DatasourceType.localFile && (
                  <LocalFile
                    files={fileList}
                    updateFile={updateFile}
                    updateFileList={updateFileList}
                    notSupportBatchUpload={false} // only support single file upload in test run
                  />
                )}
                {datasource?.type === DatasourceType.onlineDocument && (
                  <Notion
                    nodeId={datasource?.nodeId || ''}
                    notionPages={notionPages}
                    updateNotionPages={updateNotionPages}
                  />
                )}
                {datasource?.type === DatasourceType.websiteCrawl && (
                  <WebsiteCrawl
                    nodeId={datasource?.nodeId || ''}
                    variables={datasource?.variables}
                    checkedCrawlResult={websitePages}
                    headerInfo={{
                      title: datasource.description,
                      docTitle: datasource.docTitle || '',
                      docLink: datasource.docLink || '',
                    }}
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
  )
}

export default TestRunPanel
