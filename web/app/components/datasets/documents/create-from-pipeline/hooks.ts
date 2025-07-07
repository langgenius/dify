import { useTranslation } from 'react-i18next'
import { AddDocumentsStep } from './types'
import type { DataSourceOption } from '@/app/components/rag-pipeline/components/panel/test-run/types'
import { useCallback, useMemo, useState } from 'react'
import { BlockEnum, type Node } from '@/app/components/workflow/types'
import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import { useDataSourceStore, useDataSourceStoreWithSelector } from './data-source/store'

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
  const fileList = useDataSourceStoreWithSelector(state => state.localFileList)
  const previewFileRef = useDataSourceStoreWithSelector(state => state.previewLocalFileRef)
  const currentLocalFile = useDataSourceStoreWithSelector(state => state.currentLocalFile)
  const dataSourceStore = useDataSourceStore()

  const allFileLoaded = useMemo(() => (fileList.length > 0 && fileList.every(file => file.file.id)), [fileList])

  const hidePreviewLocalFile = useCallback(() => {
    const { setCurrentLocalFile } = dataSourceStore.getState()
    setCurrentLocalFile(undefined)
  }, [dataSourceStore])

  return {
    fileList,
    previewFileRef,
    allFileLoaded,
    currentLocalFile,
    hidePreviewLocalFile,
  }
}

export const useOnlineDocuments = () => {
  const onlineDocuments = useDataSourceStoreWithSelector(state => state.onlineDocuments)
  const previewOnlineDocumentRef = useDataSourceStoreWithSelector(state => state.previewOnlineDocumentRef)
  const currentDocument = useDataSourceStoreWithSelector(state => state.currentDocument)
  const dataSourceStore = useDataSourceStore()

  const hidePreviewOnlineDocument = useCallback(() => {
    const { setCurrentDocument } = dataSourceStore.getState()
    setCurrentDocument(undefined)
  }, [dataSourceStore])

  return {
    onlineDocuments,
    currentDocument,
    previewOnlineDocumentRef,
    hidePreviewOnlineDocument,
  }
}

export const useWebsiteCrawl = () => {
  const websitePages = useDataSourceStoreWithSelector(state => state.websitePages)
  const currentWebsite = useDataSourceStoreWithSelector(state => state.currentWebsite)
  const previewWebsitePageRef = useDataSourceStoreWithSelector(state => state.previewWebsitePageRef)
  const dataSourceStore = useDataSourceStore()

  const hideWebsitePreview = useCallback(() => {
    const { setCurrentWebsite, setPreviewIndex } = dataSourceStore.getState()
    setCurrentWebsite(undefined)
    setPreviewIndex(-1)
  }, [dataSourceStore])

  return {
    websitePages,
    previewWebsitePageRef,
    currentWebsite,
    hideWebsitePreview,
  }
}

export const useOnlineDrive = () => {
  const fileList = useDataSourceStoreWithSelector(state => state.fileList)
  const selectedFileList = useDataSourceStoreWithSelector(state => state.selectedFileList)

  return {
    fileList,
    selectedFileList,
  }
}
