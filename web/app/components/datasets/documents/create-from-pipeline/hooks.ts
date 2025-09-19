import { useTranslation } from 'react-i18next'
import { AddDocumentsStep } from './types'
import type { DataSourceOption } from '@/app/components/rag-pipeline/components/panel/test-run/types'
import { useCallback, useMemo, useState } from 'react'
import { BlockEnum, type Node } from '@/app/components/workflow/types'
import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import { useDataSourceStore, useDataSourceStoreWithSelector } from './data-source/store'
import type { DataSourceNotionPageMap, DataSourceNotionWorkspace } from '@/models/common'
import { useShallow } from 'zustand/react/shallow'
import { CrawlStep } from '@/models/datasets'

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
  const {
    localFileList,
    currentLocalFile,
  } = useDataSourceStoreWithSelector(useShallow(state => ({
    localFileList: state.localFileList,
    currentLocalFile: state.currentLocalFile,
  })))
  const dataSourceStore = useDataSourceStore()

  const allFileLoaded = useMemo(() => (localFileList.length > 0 && localFileList.every(file => file.file.id)), [localFileList])

  const hidePreviewLocalFile = useCallback(() => {
    const { setCurrentLocalFile } = dataSourceStore.getState()
    setCurrentLocalFile(undefined)
  }, [dataSourceStore])

  return {
    localFileList,
    allFileLoaded,
    currentLocalFile,
    hidePreviewLocalFile,
  }
}

export const useOnlineDocument = () => {
  const {
    documentsData,
    onlineDocuments,
    currentDocument,
  } = useDataSourceStoreWithSelector(useShallow(state => ({
    documentsData: state.documentsData,
    onlineDocuments: state.onlineDocuments,
    currentDocument: state.currentDocument,
  })))
  const dataSourceStore = useDataSourceStore()

  const currentWorkspace = documentsData[0]

  const PagesMapAndSelectedPagesId: DataSourceNotionPageMap = useMemo(() => {
    const pagesMap = (documentsData || []).reduce((prev: DataSourceNotionPageMap, next: DataSourceNotionWorkspace) => {
      next.pages.forEach((page) => {
        prev[page.page_id] = {
          ...page,
          workspace_id: next.workspace_id,
        }
      })

      return prev
    }, {})
    return pagesMap
  }, [documentsData])

  const hidePreviewOnlineDocument = useCallback(() => {
    const { setCurrentDocument } = dataSourceStore.getState()
    setCurrentDocument(undefined)
  }, [dataSourceStore])

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
    currentWorkspace,
    onlineDocuments,
    currentDocument,
    PagesMapAndSelectedPagesId,
    hidePreviewOnlineDocument,
    clearOnlineDocumentData,
  }
}

export const useWebsiteCrawl = () => {
  const {
    websitePages,
    currentWebsite,
  } = useDataSourceStoreWithSelector(useShallow(state => ({
    websitePages: state.websitePages,
    currentWebsite: state.currentWebsite,
  })))
  const dataSourceStore = useDataSourceStore()

  const hideWebsitePreview = useCallback(() => {
    const { setCurrentWebsite, setPreviewIndex } = dataSourceStore.getState()
    setCurrentWebsite(undefined)
    setPreviewIndex(-1)
  }, [dataSourceStore])

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
    websitePages,
    currentWebsite,
    hideWebsitePreview,
    clearWebsiteCrawlData,
  }
}

export const useOnlineDrive = () => {
  const {
    onlineDriveFileList,
    selectedFileIds,
  } = useDataSourceStoreWithSelector(useShallow(state => ({
    onlineDriveFileList: state.onlineDriveFileList,
    selectedFileIds: state.selectedFileIds,
  })))
  const dataSourceStore = useDataSourceStore()

  const selectedOnlineDriveFileList = useMemo(() => {
    return selectedFileIds.map(id => onlineDriveFileList.find(item => item.id === id)!)
  }, [onlineDriveFileList, selectedFileIds])

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
    onlineDriveFileList,
    selectedFileIds,
    selectedOnlineDriveFileList,
    clearOnlineDriveData,
  }
}
