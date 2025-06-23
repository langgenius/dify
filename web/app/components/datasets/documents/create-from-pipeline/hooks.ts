import { useTranslation } from 'react-i18next'
import { AddDocumentsStep } from './types'
import type { DataSourceOption, Datasource } from '@/app/components/rag-pipeline/components/panel/test-run/types'
import { useCallback, useMemo, useRef, useState } from 'react'
import { BlockEnum, type Node } from '@/app/components/workflow/types'
import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import type { DatasourceType } from '@/models/pipeline'
import type { CrawlResult, CrawlResultItem, DocumentItem, FileItem } from '@/models/datasets'
import { CrawlStep } from '@/models/datasets'
import produce from 'immer'
import type { NotionPage } from '@/models/common'

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
  const datasources: Datasource[] = useMemo(() => {
    return datasourceNodes.map((node) => {
      return {
        nodeId: node.id,
        type: node.data.provider_type as DatasourceType,
        description: node.data.datasource_label,
        docTitle: 'How to use?',
        docLink: '',
        fileExtensions: node.data.fileExtensions || [],
      }
    })
  }, [datasourceNodes])

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

  return { datasources, options }
}

export const useLocalFile = () => {
  const [fileList, setFileList] = useState<FileItem[]>([])
  const [currentFile, setCurrentFile] = useState<File | undefined>()

  const previewFile = useRef<DocumentItem>()

  const allFileLoaded = useMemo(() => (fileList.length > 0 && fileList.every(file => file.file.id)), [fileList])

  const updateFile = (fileItem: FileItem, progress: number, list: FileItem[]) => {
    const newList = produce(list, (draft) => {
      const targetIndex = draft.findIndex(file => file.fileID === fileItem.fileID)
      draft[targetIndex] = {
        ...draft[targetIndex],
        progress,
      }
    })
    setFileList(newList)
    previewFile.current = newList[0].file as DocumentItem
  }

  const updateFileList = useCallback((preparedFiles: FileItem[]) => {
    setFileList(preparedFiles)
  }, [])

  const updateCurrentFile = useCallback((file: File) => {
    setCurrentFile(file)
  }, [])

  const hideFilePreview = useCallback(() => {
    setCurrentFile(undefined)
  }, [])

  return {
    fileList,
    previewFile,
    allFileLoaded,
    updateFile,
    updateFileList,
    currentFile,
    updateCurrentFile,
    hideFilePreview,
  }
}

export const useOnlineDocuments = () => {
  const [onlineDocuments, setOnlineDocuments] = useState<NotionPage[]>([])
  const [currentDocuments, setCurrentDocuments] = useState<NotionPage | undefined>()

  const previewOnlineDocument = useRef<NotionPage>(onlineDocuments[0])

  const updateOnlineDocuments = (value: NotionPage[]) => {
    setOnlineDocuments(value)
  }

  const updateCurrentPage = useCallback((page: NotionPage) => {
    setCurrentDocuments(page)
  }, [])

  const hideOnlineDocumentPreview = useCallback(() => {
    setCurrentDocuments(undefined)
  }, [])

  return {
    onlineDocuments,
    previewOnlineDocument,
    updateOnlineDocuments,
    currentDocuments,
    updateCurrentPage,
    hideOnlineDocumentPreview,
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
