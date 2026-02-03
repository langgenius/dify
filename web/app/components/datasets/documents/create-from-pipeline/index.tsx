'use client'
import type { Datasource } from '@/app/components/rag-pipeline/components/panel/test-run/types'
import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import type { Node } from '@/app/components/workflow/types'
import type { FileIndexingEstimateResponse } from '@/models/datasets'
import type { InitialDocumentDetail } from '@/models/pipeline'
import { useBoolean } from 'ahooks'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import PlanUpgradeModal from '@/app/components/billing/plan-upgrade-modal'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { useProviderContextSelector } from '@/context/provider-context'
import { DatasourceType } from '@/models/pipeline'
import { useFileUploadConfig } from '@/service/use-common'
import { usePublishedPipelineInfo } from '@/service/use-pipeline'
import { useDataSourceStore } from './data-source/store'
import DataSourceProvider from './data-source/store/provider'
import {
  useAddDocumentsSteps,
  useDatasourceActions,
  useDatasourceUIState,
  useLocalFile,
  useOnlineDocument,
  useOnlineDrive,
  useWebsiteCrawl,
} from './hooks'
import LeftHeader from './left-header'
import { StepOneContent, StepThreeContent, StepTwoContent } from './steps'
import { StepOnePreview, StepTwoPreview } from './steps/preview-panel'

const CreateFormPipeline = () => {
  const { t } = useTranslation()
  const plan = useProviderContextSelector(state => state.plan)
  const enableBilling = useProviderContextSelector(state => state.enableBilling)
  const pipelineId = useDatasetDetailContextWithSelector(s => s.dataset?.pipeline_id)
  const dataSourceStore = useDataSourceStore()

  // Core state
  const [datasource, setDatasource] = useState<Datasource>()
  const [estimateData, setEstimateData] = useState<FileIndexingEstimateResponse | undefined>(undefined)
  const [batchId, setBatchId] = useState('')
  const [documents, setDocuments] = useState<InitialDocumentDetail[]>([])

  // Data fetching
  const { data: pipelineInfo, isFetching: isFetchingPipelineInfo } = usePublishedPipelineInfo(pipelineId || '')
  const { data: fileUploadConfigResponse } = useFileUploadConfig()

  const fileUploadConfig = useMemo(() => fileUploadConfigResponse ?? {
    file_size_limit: 15,
    batch_count_limit: 5,
  }, [fileUploadConfigResponse])

  // Steps management
  const {
    steps,
    currentStep,
    handleNextStep: doHandleNextStep,
    handleBackStep,
  } = useAddDocumentsSteps()

  // Datasource-specific hooks
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

  // Computed values
  const isVectorSpaceFull = plan.usage.vectorSpace >= plan.total.vectorSpace
  const supportBatchUpload = !enableBilling || plan.type !== 'sandbox'

  // UI state
  const {
    datasourceType,
    isShowVectorSpaceFull,
    nextBtnDisabled,
    showSelect,
    totalOptions,
    selectedOptions,
    tip,
  } = useDatasourceUIState({
    datasource,
    allFileLoaded,
    localFileListLength: localFileList.length,
    onlineDocumentsLength: onlineDocuments.length,
    websitePagesLength: websitePages.length,
    selectedFileIdsLength: selectedFileIds.length,
    onlineDriveFileList,
    isVectorSpaceFull,
    enableBilling,
    currentWorkspacePagesLength: currentWorkspace?.pages.length ?? 0,
    fileUploadConfig,
  })

  // Plan upgrade modal
  const [isShowPlanUpgradeModal, {
    setTrue: showPlanUpgradeModal,
    setFalse: hidePlanUpgradeModal,
  }] = useBoolean(false)

  // Next step with batch upload check
  const handleNextStep = useCallback(() => {
    if (!supportBatchUpload) {
      const multipleCheckMap: Record<string, number> = {
        [DatasourceType.localFile]: localFileList.length,
        [DatasourceType.onlineDocument]: onlineDocuments.length,
        [DatasourceType.websiteCrawl]: websitePages.length,
        [DatasourceType.onlineDrive]: selectedFileIds.length,
      }
      const count = datasourceType ? multipleCheckMap[datasourceType] : 0
      if (count > 1) {
        showPlanUpgradeModal()
        return
      }
    }
    doHandleNextStep()
  }, [datasourceType, doHandleNextStep, localFileList.length, onlineDocuments.length, selectedFileIds.length, showPlanUpgradeModal, supportBatchUpload, websitePages.length])

  // Datasource actions
  const {
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
  } = useDatasourceActions({
    datasource,
    datasourceType,
    pipelineId,
    dataSourceStore,
    setEstimateData,
    setBatchId,
    setDocuments,
    handleNextStep,
    PagesMapAndSelectedPagesId,
    currentWorkspacePages: currentWorkspace?.pages,
    clearOnlineDocumentData,
    clearWebsiteCrawlData,
    clearOnlineDriveData,
    setDatasource,
  })

  if (isFetchingPipelineInfo)
    return <Loading type="app" />

  return (
    <div className="relative flex h-[calc(100vh-56px)] w-full min-w-[1024px] overflow-x-auto rounded-t-2xl border-t border-effects-highlight bg-background-default-subtle">
      <div className="h-full min-w-0 flex-1">
        <div className="flex h-full flex-col px-14">
          <LeftHeader
            steps={steps}
            title={t('addDocuments.title', { ns: 'datasetPipeline' })}
            currentStep={currentStep}
          />
          <div className="grow overflow-y-auto">
            {currentStep === 1 && (
              <StepOneContent
                datasource={datasource}
                datasourceType={datasourceType}
                pipelineNodes={(pipelineInfo?.graph.nodes || []) as Node<DataSourceNodeType>[]}
                supportBatchUpload={supportBatchUpload}
                localFileListLength={localFileList.length}
                isShowVectorSpaceFull={isShowVectorSpaceFull}
                showSelect={showSelect}
                totalOptions={totalOptions}
                selectedOptions={selectedOptions}
                tip={tip}
                nextBtnDisabled={nextBtnDisabled}
                onSelectDataSource={handleSwitchDataSource}
                onCredentialChange={handleCredentialChange}
                onSelectAll={handleSelectAll}
                onNextStep={handleNextStep}
              />
            )}
            {currentStep === 2 && (
              <StepTwoContent
                formRef={formRef}
                dataSourceNodeId={datasource!.nodeId}
                isRunning={isPending}
                onProcess={onClickProcess}
                onPreview={onClickPreview}
                onSubmit={handleSubmit}
                onBack={handleBackStep}
              />
            )}
            {currentStep === 3 && (
              <StepThreeContent
                batchId={batchId}
                documents={documents}
              />
            )}
          </div>
        </div>
      </div>

      {/* Preview Panel */}
      {currentStep === 1 && (
        <StepOnePreview
          datasource={datasource}
          currentLocalFile={currentLocalFile}
          currentDocument={currentDocument}
          currentWebsite={currentWebsite}
          hidePreviewLocalFile={hidePreviewLocalFile}
          hidePreviewOnlineDocument={hidePreviewOnlineDocument}
          hideWebsitePreview={hideWebsitePreview}
        />
      )}
      {currentStep === 2 && (
        <StepTwoPreview
          datasourceType={datasourceType}
          localFileList={localFileList}
          onlineDocuments={onlineDocuments}
          websitePages={websitePages}
          selectedOnlineDriveFileList={selectedOnlineDriveFileList}
          isIdle={isIdle}
          isPendingPreview={isPending && isPreview.current}
          estimateData={estimateData}
          onPreview={onClickPreview}
          handlePreviewFileChange={handlePreviewFileChange}
          handlePreviewOnlineDocumentChange={handlePreviewOnlineDocumentChange}
          handlePreviewWebsitePageChange={handlePreviewWebsiteChange}
          handlePreviewOnlineDriveFileChange={handlePreviewOnlineDriveFileChange}
        />
      )}

      {/* Plan Upgrade Modal */}
      {isShowPlanUpgradeModal && (
        <PlanUpgradeModal
          show
          onClose={hidePlanUpgradeModal}
          title={t('upgrade.uploadMultiplePages.title', { ns: 'billing' })!}
          description={t('upgrade.uploadMultiplePages.description', { ns: 'billing' })!}
        />
      )}
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
