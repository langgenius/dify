'use client'
import { useCallback, useMemo, useRef, useState } from 'react'
import DataSourceOptions from './data-source-options'
import type { CrawlResultItem, DocumentItem, CustomFile as File, FileIndexingEstimateResponse } from '@/models/datasets'
import LocalFile from '@/app/components/datasets/documents/create-from-pipeline/data-source/local-file'
import { useProviderContextSelector } from '@/context/provider-context'
import type { NotionPage } from '@/models/common'
import OnlineDocuments from '@/app/components/datasets/documents/create-from-pipeline/data-source/online-documents'
import VectorSpaceFull from '@/app/components/billing/vector-space-full'
import WebsiteCrawl from '@/app/components/datasets/documents/create-from-pipeline/data-source/website-crawl'
import OnlineDrive from '@/app/components/datasets/documents/create-from-pipeline/data-source/online-drive'
import Actions from './actions'
import { useTranslation } from 'react-i18next'
import type { Datasource } from '@/app/components/rag-pipeline/components/panel/test-run/types'
import LeftHeader from './left-header'
import { usePublishedPipelineInfo, useRunPublishedPipeline } from '@/service/use-pipeline'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import Loading from '@/app/components/base/loading'
import type { Node } from '@/app/components/workflow/types'
import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import FilePreview from './preview/file-preview'
import OnlineDocumentPreview from './preview/online-document-preview'
import WebsitePreview from './preview/web-preview'
import ProcessDocuments from './process-documents'
import ChunkPreview from './preview/chunk-preview'
import Processing from './processing'
import type {
  InitialDocumentDetail,
  OnlineDriveFile,
  PublishedPipelineRunPreviewResponse,
  PublishedPipelineRunResponse,
} from '@/models/pipeline'
import { DatasourceType } from '@/models/pipeline'
import { TransferMethod } from '@/types/app'
import { useAddDocumentsSteps, useLocalFile, useOnlineDocument, useOnlineDrive, useWebsiteCrawl } from './hooks'
import DataSourceProvider from './data-source/store/provider'
import { useDataSourceStore } from './data-source/store'
import { useFileUploadConfig } from '@/service/use-common'

const CreateFormPipeline = () => {
  const { t } = useTranslation()
  const plan = useProviderContextSelector(state => state.plan)
  const enableBilling = useProviderContextSelector(state => state.enableBilling)
  const pipelineId = useDatasetDetailContextWithSelector(s => s.dataset?.pipeline_id)
  const [datasource, setDatasource] = useState<Datasource>()
  const [estimateData, setEstimateData] = useState<FileIndexingEstimateResponse | undefined>(undefined)
  const [batchId, setBatchId] = useState('')
  const [documents, setDocuments] = useState<InitialDocumentDetail[]>([])
  const dataSourceStore = useDataSourceStore()

  const isPreview = useRef(false)
  const formRef = useRef<any>(null)

  const { data: pipelineInfo, isFetching: isFetchingPipelineInfo } = usePublishedPipelineInfo(pipelineId || '')
  const { data: fileUploadConfigResponse } = useFileUploadConfig()

  const {
    steps,
    currentStep,
    handleNextStep,
    handleBackStep,
  } = useAddDocumentsSteps()
  const {
    localFileList,
    allFileLoaded,
    currentLocalFile,
    hidePreviewLocalFile,
  } = useLocalFile()
  const {
    currentWorkspace,
    onlineDocuments,
    currentDocument,
    PagesMapAndSelectedPagesId,
    hidePreviewOnlineDocument,
    clearOnlineDocumentData,
  } = useOnlineDocument()
  const {
    websitePages,
    currentWebsite,
    hideWebsitePreview,
    clearWebsiteCrawlData,
  } = useWebsiteCrawl()
  const {
    onlineDriveFileList,
    selectedFileIds,
    selectedOnlineDriveFileList,
    clearOnlineDriveData,
  } = useOnlineDrive()

  const datasourceType = useMemo(() => datasource?.nodeData.provider_type, [datasource])
  const isVectorSpaceFull = plan.usage.vectorSpace >= plan.total.vectorSpace
  const isShowVectorSpaceFull = useMemo(() => {
    if (!datasource)
      return false
    if (datasourceType === DatasourceType.localFile)
      return allFileLoaded && isVectorSpaceFull && enableBilling
    if (datasourceType === DatasourceType.onlineDocument)
      return onlineDocuments.length > 0 && isVectorSpaceFull && enableBilling
    if (datasourceType === DatasourceType.websiteCrawl)
      return websitePages.length > 0 && isVectorSpaceFull && enableBilling
    if (datasourceType === DatasourceType.onlineDrive)
      return onlineDriveFileList.length > 0 && isVectorSpaceFull && enableBilling
    return false
  }, [allFileLoaded, datasource, datasourceType, enableBilling, isVectorSpaceFull, onlineDocuments.length, onlineDriveFileList.length, websitePages.length])
  const notSupportBatchUpload = enableBilling && plan.type === 'sandbox'

  const nextBtnDisabled = useMemo(() => {
    if (!datasource) return true
    if (datasourceType === DatasourceType.localFile)
      return isShowVectorSpaceFull || !localFileList.length || !allFileLoaded
    if (datasourceType === DatasourceType.onlineDocument)
      return isShowVectorSpaceFull || !onlineDocuments.length
    if (datasourceType === DatasourceType.websiteCrawl)
      return isShowVectorSpaceFull || !websitePages.length
    if (datasourceType === DatasourceType.onlineDrive)
      return isShowVectorSpaceFull || !selectedFileIds.length
    return false
  }, [datasource, datasourceType, isShowVectorSpaceFull, localFileList.length, allFileLoaded, onlineDocuments.length, websitePages.length, selectedFileIds.length])

  const fileUploadConfig = useMemo(() => fileUploadConfigResponse ?? {
    file_size_limit: 15,
    batch_count_limit: 5,
  }, [fileUploadConfigResponse])

  const showSelect = useMemo(() => {
    if (datasourceType === DatasourceType.onlineDocument) {
      const pagesCount = currentWorkspace?.pages.length ?? 0
      return pagesCount > 0
    }
    if (datasourceType === DatasourceType.onlineDrive) {
      const isBucketList = onlineDriveFileList.some(file => file.type === 'bucket')
      return !isBucketList && onlineDriveFileList.filter((item) => {
        return item.type !== 'bucket'
      }).length > 0
    }
  }, [currentWorkspace?.pages.length, datasourceType, onlineDriveFileList])

  const totalOptions = useMemo(() => {
    if (datasourceType === DatasourceType.onlineDocument)
      return currentWorkspace?.pages.length
    if (datasourceType === DatasourceType.onlineDrive) {
      return onlineDriveFileList.filter((item) => {
        return item.type !== 'bucket'
      }).length
    }
  }, [currentWorkspace?.pages.length, datasourceType, onlineDriveFileList])

  const selectedOptions = useMemo(() => {
    if (datasourceType === DatasourceType.onlineDocument)
      return onlineDocuments.length
    if (datasourceType === DatasourceType.onlineDrive)
      return selectedFileIds.length
  }, [datasourceType, onlineDocuments.length, selectedFileIds.length])

  const tip = useMemo(() => {
    if (datasourceType === DatasourceType.onlineDocument)
      return t('datasetPipeline.addDocuments.selectOnlineDocumentTip', { count: 50 })
    if (datasourceType === DatasourceType.onlineDrive) {
      return t('datasetPipeline.addDocuments.selectOnlineDriveTip', {
        count: fileUploadConfig.batch_count_limit,
        fileSize: fileUploadConfig.file_size_limit,
      })
    }
    return ''
  }, [datasourceType, fileUploadConfig.batch_count_limit, fileUploadConfig.file_size_limit, t])

  const { mutateAsync: runPublishedPipeline, isIdle, isPending } = useRunPublishedPipeline()

  const handlePreviewChunks = useCallback(async (data: Record<string, any>) => {
    if (!datasource)
      return
    const {
      previewLocalFileRef,
      previewOnlineDocumentRef,
      previewWebsitePageRef,
      previewOnlineDriveFileRef,
      currentCredentialId,
    } = dataSourceStore.getState()
    const datasourceInfoList: Record<string, any>[] = []
    if (datasourceType === DatasourceType.localFile) {
      const { id, name, type, size, extension, mime_type } = previewLocalFileRef.current as File
      const documentInfo = {
        related_id: id,
        name,
        type,
        size,
        extension,
        mime_type,
        url: '',
        transfer_method: TransferMethod.local_file,
        credential_id: currentCredentialId,
      }
      datasourceInfoList.push(documentInfo)
    }
    if (datasourceType === DatasourceType.onlineDocument) {
      const { workspace_id, ...rest } = previewOnlineDocumentRef.current!
      const documentInfo = {
        workspace_id,
        page: rest,
        credential_id: currentCredentialId,
      }
      datasourceInfoList.push(documentInfo)
    }
    if (datasourceType === DatasourceType.websiteCrawl) {
      datasourceInfoList.push({
        ...previewWebsitePageRef.current!,
        credential_id: currentCredentialId,
      })
    }
    if (datasourceType === DatasourceType.onlineDrive) {
      const { bucket } = dataSourceStore.getState()
      const { id, type, name } = previewOnlineDriveFileRef.current!
      datasourceInfoList.push({
        bucket,
        id,
        name,
        type,
        credential_id: currentCredentialId,
      })
    }
    await runPublishedPipeline({
      pipeline_id: pipelineId!,
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
  }, [datasource, datasourceType, runPublishedPipeline, pipelineId, dataSourceStore])

  const handleProcess = useCallback(async (data: Record<string, any>) => {
    if (!datasource)
      return
    const { currentCredentialId } = dataSourceStore.getState()
    const datasourceInfoList: Record<string, any>[] = []
    if (datasourceType === DatasourceType.localFile) {
      const {
        localFileList,
      } = dataSourceStore.getState()
      localFileList.forEach((file) => {
        const { id, name, type, size, extension, mime_type } = file.file
        const documentInfo = {
          related_id: id,
          name,
          type,
          size,
          extension,
          mime_type,
          url: '',
          transfer_method: TransferMethod.local_file,
          credential_id: currentCredentialId,
        }
        datasourceInfoList.push(documentInfo)
      })
    }
    if (datasourceType === DatasourceType.onlineDocument) {
      const {
        onlineDocuments,
      } = dataSourceStore.getState()
      onlineDocuments.forEach((page) => {
        const { workspace_id, ...rest } = page
        const documentInfo = {
          workspace_id,
          page: rest,
          credential_id: currentCredentialId,
        }
        datasourceInfoList.push(documentInfo)
      })
    }
    if (datasourceType === DatasourceType.websiteCrawl) {
      const {
        websitePages,
      } = dataSourceStore.getState()
      websitePages.forEach((websitePage) => {
        datasourceInfoList.push({
          ...websitePage,
          credential_id: currentCredentialId,
        })
      })
    }
    if (datasourceType === DatasourceType.onlineDrive) {
      const {
        bucket,
        selectedFileIds,
        onlineDriveFileList,
      } = dataSourceStore.getState()
      selectedFileIds.forEach((id) => {
        const file = onlineDriveFileList.find(file => file.id === id)
        datasourceInfoList.push({
          bucket,
          id: file?.id,
          name: file?.name,
          type: file?.type,
          credential_id: currentCredentialId,
        })
      })
    }
    await runPublishedPipeline({
      pipeline_id: pipelineId!,
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
      },
    })
  }, [dataSourceStore, datasource, datasourceType, handleNextStep, pipelineId, runPublishedPipeline])

  const onClickProcess = useCallback(() => {
    isPreview.current = false
    formRef.current?.submit()
  }, [])

  const onClickPreview = useCallback(() => {
    isPreview.current = true
    formRef.current?.submit()
  }, [])

  const handleSubmit = useCallback((data: Record<string, any>) => {
    if (isPreview.current)
      handlePreviewChunks(data)
    else
      handleProcess(data)
  }, [handlePreviewChunks, handleProcess])

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
      const allIds = currentWorkspace?.pages.map(page => page.page_id) || []
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
      const allKeys = onlineDriveFileList.filter((item) => {
        return item.type !== 'bucket'
      }).map(file => file.id)
      if (selectedFileIds.length < allKeys.length)
        setSelectedFileIds(allKeys)
      else
        setSelectedFileIds([])
    }
  }, [PagesMapAndSelectedPagesId, currentWorkspace?.pages, dataSourceStore, datasourceType])

  const clearDataSourceData = useCallback((dataSource: Datasource) => {
    if (dataSource.nodeData.provider_type === DatasourceType.onlineDocument)
      clearOnlineDocumentData()
    else if (dataSource.nodeData.provider_type === DatasourceType.websiteCrawl)
      clearWebsiteCrawlData()
    else if (dataSource.nodeData.provider_type === DatasourceType.onlineDrive)
      clearOnlineDriveData()
  }, [])

  const handleSwitchDataSource = useCallback((dataSource: Datasource) => {
    const {
      setCurrentCredentialId,
      currentNodeIdRef,
    } = dataSourceStore.getState()
    clearDataSourceData(dataSource)
    setCurrentCredentialId('')
    currentNodeIdRef.current = dataSource.nodeId
    setDatasource(dataSource)
  }, [dataSourceStore])

  const handleCredentialChange = useCallback((credentialId: string) => {
    const { setCurrentCredentialId } = dataSourceStore.getState()
    clearDataSourceData(datasource!)
    setCurrentCredentialId(credentialId)
  }, [dataSourceStore, datasource])

  if (isFetchingPipelineInfo) {
    return (
      <Loading type='app' />
    )
  }

  return (
    <div
      className='relative flex h-[calc(100vh-56px)] w-full min-w-[1024px] overflow-x-auto rounded-t-2xl border-t border-effects-highlight bg-background-default-subtle'
    >
      <div className='h-full min-w-0 flex-1'>
        <div className='flex h-full flex-col px-14'>
          <LeftHeader
            steps={steps}
            title={t('datasetPipeline.addDocuments.title')}
            currentStep={currentStep}
          />
          <div className='grow overflow-y-auto'>
            {
              currentStep === 1 && (
                <div className='flex flex-col gap-y-5 pt-4'>
                  <DataSourceOptions
                    datasourceNodeId={datasource?.nodeId || ''}
                    onSelect={handleSwitchDataSource}
                    pipelineNodes={(pipelineInfo?.graph.nodes || []) as Node<DataSourceNodeType>[]}
                  />
                  {datasourceType === DatasourceType.localFile && (
                    <LocalFile
                      allowedExtensions={datasource!.nodeData.fileExtensions || []}
                      notSupportBatchUpload={notSupportBatchUpload}
                    />
                  )}
                  {datasourceType === DatasourceType.onlineDocument && (
                    <OnlineDocuments
                      nodeId={datasource!.nodeId}
                      nodeData={datasource!.nodeData}
                      onCredentialChange={handleCredentialChange}
                    />
                  )}
                  {datasourceType === DatasourceType.websiteCrawl && (
                    <WebsiteCrawl
                      nodeId={datasource!.nodeId}
                      nodeData={datasource!.nodeData}
                      onCredentialChange={handleCredentialChange}
                    />
                  )}
                  {datasourceType === DatasourceType.onlineDrive && (
                    <OnlineDrive
                      nodeId={datasource!.nodeId}
                      nodeData={datasource!.nodeData}
                      onCredentialChange={handleCredentialChange}
                    />
                  )}
                  {isShowVectorSpaceFull && (
                    <VectorSpaceFull />
                  )}
                  <Actions
                    showSelect={showSelect}
                    totalOptions={totalOptions}
                    selectedOptions={selectedOptions}
                    onSelectAll={handleSelectAll}
                    disabled={nextBtnDisabled}
                    handleNextStep={handleNextStep}
                    tip={tip}
                  />
                </div>
              )
            }
            {
              currentStep === 2 && (
                <ProcessDocuments
                  ref={formRef}
                  dataSourceNodeId={datasource!.nodeId}
                  isRunning={isPending}
                  onProcess={onClickProcess}
                  onPreview={onClickPreview}
                  onSubmit={handleSubmit}
                  onBack={handleBackStep}
                />
              )
            }
            {
              currentStep === 3 && (
                <Processing
                  batchId={batchId}
                  documents={documents}
                />
              )
            }
          </div>
        </div>
      </div>
      {/* Preview */}
      {
        currentStep === 1 && (
          <div className='h-full min-w-0 flex-1'>
            <div className='flex h-full flex-col pl-2 pt-2'>
              {currentLocalFile && (
                <FilePreview
                  file={currentLocalFile}
                  hidePreview={hidePreviewLocalFile}
                />
              )}
              {currentDocument && (
                <OnlineDocumentPreview
                  datasourceNodeId={datasource!.nodeId}
                  currentPage={currentDocument}
                  hidePreview={hidePreviewOnlineDocument}
                />
              )}
              {currentWebsite && (
                <WebsitePreview
                  currentWebsite={currentWebsite}
                  hidePreview={hideWebsitePreview}
                />
              )}
            </div>
          </div>
        )
      }
      {
        currentStep === 2 && (
          <div className='h-full min-w-0 flex-1'>
            <div className='flex h-full flex-col pl-2 pt-2'>
              <ChunkPreview
                dataSourceType={datasourceType as DatasourceType}
                localFiles={localFileList.map(file => file.file)}
                onlineDocuments={onlineDocuments}
                websitePages={websitePages}
                onlineDriveFiles={selectedOnlineDriveFileList}
                isIdle={isIdle}
                isPending={isPending && isPreview.current}
                estimateData={estimateData}
                onPreview={onClickPreview}
                handlePreviewFileChange={handlePreviewFileChange}
                handlePreviewOnlineDocumentChange={handlePreviewOnlineDocumentChange}
                handlePreviewWebsitePageChange={handlePreviewWebsiteChange}
                handlePreviewOnlineDriveFileChange={handlePreviewOnlineDriveFileChange}
              />
            </div>
          </div>
        )
      }
    </div>
  )
}

const CreateFormPipelineWrapper = () => {
  return (
    <DataSourceProvider>
      <CreateFormPipeline />
    </DataSourceProvider>
  )
}

export default CreateFormPipelineWrapper
