import { useStore } from '@/app/components/workflow/store'
import { RiCloseLine } from '@remixicon/react'
import { useCallback, useMemo, useState } from 'react'
import StepIndicator from './step-indicator'
import { useTestRunSteps } from './hooks'
import DataSourceOptions from './data-source-options'
import type { FileItem } from '@/models/datasets'
import { DataSourceType } from '@/models/datasets'
import LocalFile from './data-source/local-file'
import produce from 'immer'
import Button from '@/app/components/base/button'
import { useTranslation } from 'react-i18next'
import { useProviderContextSelector } from '@/context/provider-context'
import type { NotionPage } from '@/models/common'
import Notion from './data-source/notion'

const TestRunPanel = () => {
  const { t } = useTranslation()
  const [currentStep, setCurrentStep] = useState(0)
  const [dataSourceType, setDataSourceType] = useState<string>(DataSourceType.FILE)
  const [fileList, setFiles] = useState<FileItem[]>([])
  const [notionPages, setNotionPages] = useState<NotionPage[]>([])

  const setShowTestRunPanel = useStore(s => s.setShowTestRunPanel)
  const plan = useProviderContextSelector(state => state.plan)
  const enableBilling = useProviderContextSelector(state => state.enableBilling)

  const steps = useTestRunSteps()
  const dataSources = ['upload_file', 'notion_import', 'firecrawl', 'jinareader', 'watercrawl'] // TODO: replace with real data sources

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

  const handleClose = () => {
    setShowTestRunPanel?.(false)
  }

  const handleDataSourceSelect = useCallback((option: string) => {
    setDataSourceType(option)
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
    <div className='relative flex h-full w-[480px] flex-col rounded-l-2xl border-y-[0.5px] border-l-[0.5px] border-components-panel-border bg-components-panel-bg shadow-xl shadow-shadow-shadow-1'>
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
      {
        currentStep === 0 && (
          <>
            <div className='flex flex-col gap-y-4 px-4 py-2'>
              <DataSourceOptions
                dataSources={dataSources}
                dataSourceType={dataSourceType}
                onSelect={handleDataSourceSelect}
              />
              {dataSourceType === DataSourceType.FILE && (
                <LocalFile
                  files={fileList}
                  updateFile={updateFile}
                  updateFileList={updateFileList}
                  notSupportBatchUpload={notSupportBatchUpload}
                  isShowVectorSpaceFull={isShowVectorSpaceFull}
                />
              )}
              {dataSourceType === DataSourceType.NOTION && (
                <Notion
                  notionPages={notionPages}
                  updateNotionPages={updateNotionPages}
                  isShowVectorSpaceFull={isShowVectorSpaceFull}
                />
              )}
            </div>
            <div className='flex justify-end p-4 pt-2'>
              {dataSourceType === DataSourceType.FILE && (
                <Button disabled={nextDisabled} variant='primary' onClick={handleNextStep}>
                  <span className='px-0.5'>{t('datasetCreation.stepOne.button')}</span>
                </Button>
              )}
              {dataSourceType === DataSourceType.NOTION && (
                <Button disabled={isShowVectorSpaceFull || !notionPages.length} variant='primary' onClick={handleNextStep}>
                  <span className="px-0.5">{t('datasetCreation.stepOne.button')}</span>
                </Button>
              )}
            </div>
          </>
        )
      }
    </div>
  )
}

export default TestRunPanel
