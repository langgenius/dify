import { useTranslation } from 'react-i18next'
import { AddDocumentsStep } from './types'
import type { DataSourceOption } from '@/app/components/rag-pipeline/components/panel/test-run/types'
import { useCallback, useMemo, useRef, useState } from 'react'
import { BlockEnum, type Node } from '@/app/components/workflow/types'
import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import type { CrawlResult, CrawlResultItem } from '@/models/datasets'
import { CrawlStep } from '@/models/datasets'
import { useDataSourceStore } from './data-source/store'

export const useAddDocumentsSteps = () => {
  const { t } = useTranslation()
  const [currentStep, setCurrentStep] = useState(1)

  const handleNextStep = useCallback(() => {
    setCurrentStep(preStep => preStep + 1)
  }, [])

  const handleBackStep = useCallback(() => {
    setCurrentStep(preStep => preStep - 1)
  }, [])

  const steps = [
    {
      label: t('datasetPipeline.addDocuments.steps.chooseDatasource'),
      value: AddDocumentsStep.dataSource,
    },
    {
      label: t('datasetPipeline.addDocuments.steps.processDocuments'),
      value: AddDocumentsStep.processDocuments,
    },
    {
      label: t('datasetPipeline.addDocuments.steps.processingDocuments'),
      value: AddDocumentsStep.processingDocuments,
    },
  ]

  return {
    steps,
    currentStep,
    handleNextStep,
    handleBackStep,
  }
}

export const useDatasourceOptions = (pipelineNodes: Node<DataSourceNodeType>[]) => {
  const datasourceNodes = pipelineNodes.filter(node => node.data.type === BlockEnum.DataSource)

  const options = useMemo(() => {
    const options: DataSourceOption[] = []
    datasourceNodes.forEach((node) => {
      const label = node.data.title
      options.push({
        label,
        value: node.id,
        data: node.data,
      })
    })
    return options
  }, [datasourceNodes])

  return options
}

export const useLocalFile = () => {
  const fileList = useDataSourceStore(state => state.localFileList)
  const previewFileRef = useDataSourceStore(state => state.previewLocalFileRef)
  const currentLocalFile = useDataSourceStore(state => state.currentLocalFile)
  const setCurrentFile = useDataSourceStore(state => state.setCurrentLocalFile)

  const allFileLoaded = useMemo(() => (fileList.length > 0 && fileList.every(file => file.file.id)), [fileList])

  const hidePreviewLocalFile = useCallback(() => {
    setCurrentFile(undefined)
  }, [setCurrentFile])

  return {
    fileList,
    previewFileRef,
    allFileLoaded,
    currentLocalFile,
    hidePreviewLocalFile,
  }
}

export const useOnlineDocuments = () => {
  const onlineDocuments = useDataSourceStore(state => state.onlineDocuments)
  const previewOnlineDocumentRef = useDataSourceStore(state => state.previewOnlineDocumentRef)
  const setCurrentDocument = useDataSourceStore(state => state.setCurrentDocument)
  const currentDocument = useDataSourceStore(state => state.currentDocument)

  const hidePreviewOnlineDocument = useCallback(() => {
    setCurrentDocument(undefined)
  }, [setCurrentDocument])

  return {
    onlineDocuments,
    currentDocument,
    previewOnlineDocumentRef,
    hidePreviewOnlineDocument,
  }
}

export const useWebsiteCrawl = () => {
  const [websitePages, setWebsitePages] = useState<CrawlResultItem[]>([])
  const [currentWebsite, setCurrentWebsite] = useState<CrawlResultItem | undefined>()
  const [crawlResult, setCrawlResult] = useState<CrawlResult | undefined>()
  const [step, setStep] = useState<CrawlStep>(CrawlStep.init)
  const [previewIndex, setPreviewIndex] = useState<number>(-1)

  const previewWebsitePage = useRef<CrawlResultItem>(websitePages[0])

  const updateCurrentWebsite = useCallback((website: CrawlResultItem, index: number) => {
    setCurrentWebsite(website)
    setPreviewIndex(index)
  }, [])

  const hideWebsitePreview = useCallback(() => {
    setCurrentWebsite(undefined)
    setPreviewIndex(-1)
  }, [])

  const updataCheckedCrawlResultChange = useCallback((checkedCrawlResult: CrawlResultItem[]) => {
    setWebsitePages(checkedCrawlResult)
    previewWebsitePage.current = checkedCrawlResult[0]
  }, [])

  return {
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
  }
}

export const useOnlineDrive = () => {
  return {}
}
