import type { StoreApi } from 'zustand'
import type { DataSourceShape } from '@/app/components/datasets/documents/create-from-pipeline/data-source/store'
import type { Datasource } from '@/app/components/rag-pipeline/components/panel/test-run/types'
import type { DataSourceNotionPageMap, NotionPage } from '@/models/common'
import type { CrawlResultItem, DocumentItem, CustomFile as File, FileIndexingEstimateResponse } from '@/models/datasets'
import type {
  OnlineDriveFile,
  PublishedPipelineRunPreviewResponse,
  PublishedPipelineRunResponse,
} from '@/models/pipeline'
import { useCallback, useRef } from 'react'
import { trackEvent } from '@/app/components/base/amplitude'
import { DatasourceType } from '@/models/pipeline'
import { useRunPublishedPipeline } from '@/service/use-pipeline'
import {
  buildLocalFileDatasourceInfo,
  buildOnlineDocumentDatasourceInfo,
  buildOnlineDriveDatasourceInfo,
  buildWebsiteCrawlDatasourceInfo,
} from '../utils/datasource-info-builder'

type DatasourceActionsParams = {
  datasource: Datasource | undefined
  datasourceType: string | undefined
  pipelineId: string | undefined
  dataSourceStore: StoreApi<DataSourceShape>
  setEstimateData: (data: FileIndexingEstimateResponse | undefined) => void
  setBatchId: (id: string) => void
  setDocuments: (docs: PublishedPipelineRunResponse['documents']) => void
  handleNextStep: () => void
  PagesMapAndSelectedPagesId: DataSourceNotionPageMap
  currentWorkspacePages: { page_id: string }[] | undefined
  clearOnlineDocumentData: () => void
  clearWebsiteCrawlData: () => void
  clearOnlineDriveData: () => void
  setDatasource: (ds: Datasource) => void
}

/**
 * Hook for datasource-related actions (preview, process, etc.)
 */
export const useDatasourceActions = ({
  datasource,
  datasourceType,
  pipelineId,
  dataSourceStore,
  setEstimateData,
  setBatchId,
  setDocuments,
  handleNextStep,
  PagesMapAndSelectedPagesId,
  currentWorkspacePages,
  clearOnlineDocumentData,
  clearWebsiteCrawlData,
  clearOnlineDriveData,
  setDatasource,
}: DatasourceActionsParams) => {
  const isPreview = useRef(false)
  const formRef = useRef<{ submit: () => void } | null>(null)

  const { mutateAsync: runPublishedPipeline, isIdle, isPending } = useRunPublishedPipeline()

  // Build datasource info for preview (single item)
  const buildPreviewDatasourceInfo = useCallback(() => {
    const {
      previewLocalFileRef,
      previewOnlineDocumentRef,
      previewWebsitePageRef,
      previewOnlineDriveFileRef,
      currentCredentialId,
      bucket,
    } = dataSourceStore.getState()

    const datasourceInfoList: Record<string, unknown>[] = []

    if (datasourceType === DatasourceType.localFile && previewLocalFileRef.current) {
      datasourceInfoList.push(buildLocalFileDatasourceInfo(
        previewLocalFileRef.current as File,
        currentCredentialId,
      ))
    }

    if (datasourceType === DatasourceType.onlineDocument && previewOnlineDocumentRef.current) {
      datasourceInfoList.push(buildOnlineDocumentDatasourceInfo(
        previewOnlineDocumentRef.current,
        currentCredentialId,
      ))
    }

    if (datasourceType === DatasourceType.websiteCrawl && previewWebsitePageRef.current) {
      datasourceInfoList.push(buildWebsiteCrawlDatasourceInfo(
        previewWebsitePageRef.current,
        currentCredentialId,
      ))
    }

    if (datasourceType === DatasourceType.onlineDrive && previewOnlineDriveFileRef.current) {
      datasourceInfoList.push(buildOnlineDriveDatasourceInfo(
        previewOnlineDriveFileRef.current,
        bucket,
        currentCredentialId,
      ))
    }

    return datasourceInfoList
  }, [dataSourceStore, datasourceType])

  // Build datasource info for processing (all items)
  const buildProcessDatasourceInfo = useCallback(() => {
    const {
      currentCredentialId,
      localFileList,
      onlineDocuments,
      websitePages,
      bucket,
      selectedFileIds,
      onlineDriveFileList,
    } = dataSourceStore.getState()

    const datasourceInfoList: Record<string, unknown>[] = []

    if (datasourceType === DatasourceType.localFile) {
      localFileList.forEach((file) => {
        datasourceInfoList.push(buildLocalFileDatasourceInfo(file.file, currentCredentialId))
      })
    }

    if (datasourceType === DatasourceType.onlineDocument) {
      onlineDocuments.forEach((page) => {
        datasourceInfoList.push(buildOnlineDocumentDatasourceInfo(page, currentCredentialId))
      })
    }

    if (datasourceType === DatasourceType.websiteCrawl) {
      websitePages.forEach((page) => {
        datasourceInfoList.push(buildWebsiteCrawlDatasourceInfo(page, currentCredentialId))
      })
    }

    if (datasourceType === DatasourceType.onlineDrive) {
      selectedFileIds.forEach((id) => {
        const file = onlineDriveFileList.find(f => f.id === id)
        if (file)
          datasourceInfoList.push(buildOnlineDriveDatasourceInfo(file, bucket, currentCredentialId))
      })
    }

    return datasourceInfoList
  }, [dataSourceStore, datasourceType])

  // Handle chunk preview
  const handlePreviewChunks = useCallback(async (data: Record<string, unknown>) => {
    if (!datasource || !pipelineId)
      return

    const datasourceInfoList = buildPreviewDatasourceInfo()
    await runPublishedPipeline({
      pipeline_id: pipelineId,
      inputs: data,
      start_node_id: datasource.nodeId,
      datasource_type: datasourceType as DatasourceType,
      datasource_info_list: datasourceInfoList,
      is_preview: true,
    }, {
      onSuccess: (res) => {
        setEstimateData((res as PublishedPipelineRunPreviewResponse).data.outputs)
      },
    })
  }, [datasource, pipelineId, datasourceType, buildPreviewDatasourceInfo, runPublishedPipeline, setEstimateData])

  // Handle document processing
  const handleProcess = useCallback(async (data: Record<string, unknown>) => {
    if (!datasource || !pipelineId)
      return

    const datasourceInfoList = buildProcessDatasourceInfo()
    await runPublishedPipeline({
      pipeline_id: pipelineId,
      inputs: data,
      start_node_id: datasource.nodeId,
      datasource_type: datasourceType as DatasourceType,
      datasource_info_list: datasourceInfoList,
      is_preview: false,
    }, {
      onSuccess: (res) => {
        setBatchId((res as PublishedPipelineRunResponse).batch || '')
        setDocuments((res as PublishedPipelineRunResponse).documents || [])
        handleNextStep()
        trackEvent('dataset_document_added', {
          data_source_type: datasourceType,
          indexing_technique: 'pipeline',
        })
      },
    })
  }, [datasource, pipelineId, datasourceType, buildProcessDatasourceInfo, runPublishedPipeline, setBatchId, setDocuments, handleNextStep])

  // Form submission handlers
  const onClickProcess = useCallback(() => {
    isPreview.current = false
    formRef.current?.submit()
  }, [])

  const onClickPreview = useCallback(() => {
    isPreview.current = true
    formRef.current?.submit()
  }, [])

  const handleSubmit = useCallback((data: Record<string, unknown>) => {
    if (isPreview.current)
      handlePreviewChunks(data)
    else
      handleProcess(data)
  }, [handlePreviewChunks, handleProcess])

  // Preview change handlers
  const handlePreviewFileChange = useCallback((file: DocumentItem) => {
    const { previewLocalFileRef } = dataSourceStore.getState()
    previewLocalFileRef.current = file
    onClickPreview()
  }, [dataSourceStore, onClickPreview])

  const handlePreviewOnlineDocumentChange = useCallback((page: NotionPage) => {
    const { previewOnlineDocumentRef } = dataSourceStore.getState()
    previewOnlineDocumentRef.current = page
    onClickPreview()
  }, [dataSourceStore, onClickPreview])

  const handlePreviewWebsiteChange = useCallback((website: CrawlResultItem) => {
    const { previewWebsitePageRef } = dataSourceStore.getState()
    previewWebsitePageRef.current = website
    onClickPreview()
  }, [dataSourceStore, onClickPreview])

  const handlePreviewOnlineDriveFileChange = useCallback((file: OnlineDriveFile) => {
    const { previewOnlineDriveFileRef } = dataSourceStore.getState()
    previewOnlineDriveFileRef.current = file
    onClickPreview()
  }, [dataSourceStore, onClickPreview])

  // Select all handler
  const handleSelectAll = useCallback(() => {
    const {
      onlineDocuments,
      onlineDriveFileList,
      selectedFileIds,
      setOnlineDocuments,
      setSelectedFileIds,
      setSelectedPagesId,
    } = dataSourceStore.getState()

    if (datasourceType === DatasourceType.onlineDocument) {
      const allIds = currentWorkspacePages?.map(page => page.page_id) || []
      if (onlineDocuments.length < allIds.length) {
        const selectedPages = Array.from(allIds).map(pageId => PagesMapAndSelectedPagesId[pageId])
        setOnlineDocuments(selectedPages)
        setSelectedPagesId(new Set(allIds))
      }
      else {
        setOnlineDocuments([])
        setSelectedPagesId(new Set())
      }
    }

    if (datasourceType === DatasourceType.onlineDrive) {
      const allKeys = onlineDriveFileList.filter(item => item.type !== 'bucket').map(file => file.id)
      if (selectedFileIds.length < allKeys.length)
        setSelectedFileIds(allKeys)
      else
        setSelectedFileIds([])
    }
  }, [PagesMapAndSelectedPagesId, currentWorkspacePages, dataSourceStore, datasourceType])

  // Clear datasource data based on type
  const clearDataSourceData = useCallback((dataSource: Datasource) => {
    const providerType = dataSource.nodeData.provider_type
    const clearFunctions: Record<string, () => void> = {
      [DatasourceType.onlineDocument]: clearOnlineDocumentData,
      [DatasourceType.websiteCrawl]: clearWebsiteCrawlData,
      [DatasourceType.onlineDrive]: clearOnlineDriveData,
      [DatasourceType.localFile]: () => {},
    }
    clearFunctions[providerType]?.()
  }, [clearOnlineDocumentData, clearOnlineDriveData, clearWebsiteCrawlData])

  // Switch datasource handler
  const handleSwitchDataSource = useCallback((dataSource: Datasource) => {
    const {
      setCurrentCredentialId,
      currentNodeIdRef,
    } = dataSourceStore.getState()
    clearDataSourceData(dataSource)
    setCurrentCredentialId('')
    currentNodeIdRef.current = dataSource.nodeId
    setDatasource(dataSource)
  }, [clearDataSourceData, dataSourceStore, setDatasource])

  // Credential change handler
  const handleCredentialChange = useCallback((credentialId: string) => {
    const { setCurrentCredentialId } = dataSourceStore.getState()
    if (datasource)
      clearDataSourceData(datasource)
    setCurrentCredentialId(credentialId)
  }, [clearDataSourceData, dataSourceStore, datasource])

  return {
    isPreview,
    formRef,
    isIdle,
    isPending,
    onClickProcess,
    onClickPreview,
    handleSubmit,
    handlePreviewFileChange,
    handlePreviewOnlineDocumentChange,
    handlePreviewWebsiteChange,
    handlePreviewOnlineDriveFileChange,
    handleSelectAll,
    handleSwitchDataSource,
    handleCredentialChange,
  }
}
