import { useTranslation } from 'react-i18next'
import type { DataSourceOption } from '../types'
import { TestRunStep } from '../types'
import { useNodes } from 'reactflow'
import { BlockEnum } from '@/app/components/workflow/types'
import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import { useCallback, useMemo, useState } from 'react'
import { useDataSourceStore } from '@/app/components/datasets/documents/create-from-pipeline/data-source/store'
import { CrawlStep } from '@/models/datasets'

export const useTestRunSteps = () => {
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
      label: t('datasetPipeline.testRun.steps.dataSource'),
      value: TestRunStep.dataSource,
    },
    {
      label: t('datasetPipeline.testRun.steps.documentProcessing'),
      value: TestRunStep.documentProcessing,
    },
  ]

  return {
    steps,
    currentStep,
    handleNextStep,
    handleBackStep,
  }
}

export const useDatasourceOptions = () => {
  const nodes = useNodes<DataSourceNodeType>()
  const datasourceNodes = nodes.filter(node => node.data.type === BlockEnum.DataSource)

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

export const useOnlineDocument = () => {
  const dataSourceStore = useDataSourceStore()

  const clearOnlineDocumentData = useCallback(() => {
    const {
      setDocumentsData,
      setSearchValue,
      setSelectedPagesId,
      setOnlineDocuments,
      setCurrentDocument,
    } = dataSourceStore.getState()
    setDocumentsData([])
    setSearchValue('')
    setSelectedPagesId(new Set())
    setOnlineDocuments([])
    setCurrentDocument(undefined)
  }, [dataSourceStore])

  return {
    clearOnlineDocumentData,
  }
}

export const useWebsiteCrawl = () => {
  const dataSourceStore = useDataSourceStore()

  const clearWebsiteCrawlData = useCallback(() => {
    const {
      setStep,
      setCrawlResult,
      setWebsitePages,
      setPreviewIndex,
      setCurrentWebsite,
    } = dataSourceStore.getState()
    setStep(CrawlStep.init)
    setCrawlResult(undefined)
    setCurrentWebsite(undefined)
    setWebsitePages([])
    setPreviewIndex(-1)
  }, [dataSourceStore])

  return {
    clearWebsiteCrawlData,
  }
}

export const useOnlineDrive = () => {
  const dataSourceStore = useDataSourceStore()

  const clearOnlineDriveData = useCallback(() => {
    const {
      setOnlineDriveFileList,
      setBucket,
      setPrefix,
      setKeywords,
      setSelectedFileIds,
    } = dataSourceStore.getState()
    setOnlineDriveFileList([])
    setBucket('')
    setPrefix([])
    setKeywords('')
    setSelectedFileIds([])
  }, [dataSourceStore])

  return {
    clearOnlineDriveData,
  }
}
