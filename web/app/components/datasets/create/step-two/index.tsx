'use client'

import type { FC } from 'react'
import type { StepTwoProps } from './types'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import Toast from '@/app/components/base/toast'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { useLocale } from '@/context/i18n'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { LanguagesSupported } from '@/i18n-config/language'
import { DataSourceProvider } from '@/models/common'
import { ChunkingMode, ProcessMode } from '@/models/datasets'
import { useFetchDefaultProcessRule } from '@/service/knowledge/use-create-dataset'
import { cn } from '@/utils/classnames'
import { GeneralChunkingOptions, IndexingModeSection, ParentChildOptions, PreviewPanel, StepTwoFooter } from './components'
import { IndexingType, MAXIMUM_CHUNK_TOKEN_LENGTH, useDocumentCreation, useIndexingConfig, useIndexingEstimate, usePreviewState, useSegmentationState } from './hooks'

export { IndexingType }

const StepTwo: FC<StepTwoProps> = ({
  isSetting,
  documentDetail,
  isAPIKeySet,
  datasetId,
  indexingType: propsIndexingType,
  dataSourceType: inCreatePageDataSourceType,
  files,
  notionPages = [],
  notionCredentialId,
  websitePages = [],
  crawlOptions,
  websiteCrawlProvider = DataSourceProvider.jinaReader,
  websiteCrawlJobId = '',
  onStepChange,
  updateIndexingTypeCache,
  updateResultCache,
  onSave,
  onCancel,
  updateRetrievalMethodCache,
}) => {
  const { t } = useTranslation()
  const locale = useLocale()
  const isMobile = useBreakpoints() === MediaType.mobile
  const currentDataset = useDatasetDetailContextWithSelector(s => s.dataset)
  const mutateDatasetRes = useDatasetDetailContextWithSelector(s => s.mutateDatasetRes)

  // Computed flags
  const isInUpload = Boolean(currentDataset)
  const isUploadInEmptyDataset = isInUpload && !currentDataset?.doc_form
  const isNotUploadInEmptyDataset = !isUploadInEmptyDataset
  const isInInit = !isInUpload && !isSetting
  const isInCreatePage = !datasetId || (datasetId && !currentDataset?.data_source_type)
  const dataSourceType = isInCreatePage ? inCreatePageDataSourceType : (currentDataset?.data_source_type ?? inCreatePageDataSourceType)
  const hasSetIndexType = !!propsIndexingType
  const isModelAndRetrievalConfigDisabled = !!datasetId && !!currentDataset?.data_source_type

  // Document form state
  const [docForm, setDocForm] = useState<ChunkingMode>((datasetId && documentDetail) ? documentDetail.doc_form as ChunkingMode : ChunkingMode.text)
  const [docLanguage, setDocLanguage] = useState<string>(() => (datasetId && documentDetail) ? documentDetail.doc_language : (locale !== LanguagesSupported[1] ? 'English' : 'Chinese Simplified'))
  const [isQAConfirmDialogOpen, setIsQAConfirmDialogOpen] = useState(false)
  const currentDocForm = currentDataset?.doc_form || docForm

  // Custom hooks
  const segmentation = useSegmentationState({
    initialSegmentationType: currentDataset?.doc_form === ChunkingMode.parentChild ? ProcessMode.parentChild : ProcessMode.general,
    initialSummaryIndexSetting: currentDataset?.summary_index_setting,
  })
  const showSummaryIndexSetting = !currentDataset
  const indexing = useIndexingConfig({
    initialIndexType: propsIndexingType,
    initialEmbeddingModel: currentDataset?.embedding_model ? { provider: currentDataset.embedding_model_provider, model: currentDataset.embedding_model } : undefined,
    initialRetrievalConfig: currentDataset?.retrieval_model_dict,
    isAPIKeySet,
    hasSetIndexType,
  })
  const preview = usePreviewState({ dataSourceType, files, notionPages, websitePages, documentDetail, datasetId })
  const creation = useDocumentCreation({
    datasetId,
    isSetting,
    documentDetail,
    dataSourceType,
    files,
    notionPages,
    notionCredentialId,
    websitePages,
    crawlOptions,
    websiteCrawlProvider,
    websiteCrawlJobId,
    onStepChange,
    updateIndexingTypeCache,
    updateResultCache,
    updateRetrievalMethodCache,
    onSave,
    mutateDatasetRes,
  })
  const estimateHook = useIndexingEstimate({
    dataSourceType,
    datasetId,
    currentDocForm,
    docLanguage,
    files,
    previewFileName: preview.previewFile?.name,
    previewNotionPage: preview.previewNotionPage,
    notionCredentialId,
    previewWebsitePage: preview.previewWebsitePage,
    crawlOptions,
    websiteCrawlProvider,
    websiteCrawlJobId,
    indexingTechnique: indexing.getIndexingTechnique() as IndexingType,
    processRule: segmentation.getProcessRule(currentDocForm),
  })

  // Fetch default process rule
  const fetchDefaultProcessRuleMutation = useFetchDefaultProcessRule({
    onSuccess(data) {
      segmentation.setSegmentIdentifier(data.rules.segmentation.separator)
      segmentation.setMaxChunkLength(data.rules.segmentation.max_tokens)
      segmentation.setOverlap(data.rules.segmentation.chunk_overlap!)
      segmentation.setRules(data.rules.pre_processing_rules)
      segmentation.setDefaultConfig(data.rules)
      segmentation.setLimitMaxChunkLength(data.limits.indexing_max_segmentation_tokens_length)
    },
  })

  // Event handlers
  const handleDocFormChange = useCallback((value: ChunkingMode) => {
    if (value === ChunkingMode.qa && indexing.indexType === IndexingType.ECONOMICAL) {
      setIsQAConfirmDialogOpen(true)
      return
    }
    if (value === ChunkingMode.parentChild && indexing.indexType === IndexingType.ECONOMICAL)
      indexing.setIndexType(IndexingType.QUALIFIED)
    setDocForm(value)
    segmentation.setSegmentationType(value === ChunkingMode.parentChild ? ProcessMode.parentChild : ProcessMode.general)
    estimateHook.reset()
  }, [indexing, segmentation, estimateHook])

  const updatePreview = useCallback(() => {
    if (segmentation.segmentationType === ProcessMode.general && segmentation.maxChunkLength > MAXIMUM_CHUNK_TOKEN_LENGTH) {
      Toast.notify({ type: 'error', message: t('stepTwo.maxLengthCheck', { ns: 'datasetCreation', limit: MAXIMUM_CHUNK_TOKEN_LENGTH }) })
      return
    }
    estimateHook.fetchEstimate()
  }, [segmentation, t, estimateHook])

  const handleCreate = useCallback(async () => {
    const isValid = creation.validateParams({
      segmentationType: segmentation.segmentationType,
      maxChunkLength: segmentation.maxChunkLength,
      limitMaxChunkLength: segmentation.limitMaxChunkLength,
      overlap: segmentation.overlap,
      indexType: indexing.indexType,
      embeddingModel: indexing.embeddingModel,
      rerankModelList: indexing.rerankModelList,
      retrievalConfig: indexing.retrievalConfig,
    })
    if (!isValid)
      return
    const params = creation.buildCreationParams(currentDocForm, docLanguage, segmentation.getProcessRule(currentDocForm), indexing.retrievalConfig, indexing.embeddingModel, indexing.getIndexingTechnique(), segmentation.summaryIndexSetting)
    if (!params)
      return
    await creation.executeCreation(params, indexing.indexType, indexing.retrievalConfig)
  }, [creation, segmentation, indexing, currentDocForm, docLanguage])

  const handlePickerChange = useCallback((selected: { id: string, name: string }) => {
    estimateHook.reset()
    preview.handlePreviewChange(selected)
    estimateHook.fetchEstimate()
  }, [estimateHook, preview])

  const handleQAConfirm = useCallback(() => {
    setIsQAConfirmDialogOpen(false)
    indexing.setIndexType(IndexingType.QUALIFIED)
    setDocForm(ChunkingMode.qa)
  }, [indexing])

  // Initialize rules
  useEffect(() => {
    if (!isSetting) {
      fetchDefaultProcessRuleMutation.mutate('/datasets/process-rule')
    }
    else if (documentDetail) {
      const rules = documentDetail.dataset_process_rule.rules
      const isHierarchical = documentDetail.doc_form === ChunkingMode.parentChild || Boolean(rules.parent_mode && rules.subchunk_segmentation)
      segmentation.applyConfigFromRules(rules, isHierarchical)
      segmentation.setSegmentationType(documentDetail.dataset_process_rule.mode)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Show options conditions
  const showGeneralOption = (isInUpload && [ChunkingMode.text, ChunkingMode.qa].includes(currentDataset!.doc_form)) || isUploadInEmptyDataset || isInInit
  const showParentChildOption = (isInUpload && currentDataset!.doc_form === ChunkingMode.parentChild) || isUploadInEmptyDataset || isInInit

  return (
    <div className="flex h-full w-full">
      <div className={cn('relative h-full w-1/2 overflow-y-auto py-6', isMobile ? 'px-4' : 'px-12')}>
        <div className="system-md-semibold mb-1 text-text-secondary">{t('stepTwo.segmentation', { ns: 'datasetCreation' })}</div>
        {showGeneralOption && (
          <GeneralChunkingOptions
            segmentIdentifier={segmentation.segmentIdentifier}
            maxChunkLength={segmentation.maxChunkLength}
            overlap={segmentation.overlap}
            rules={segmentation.rules}
            currentDocForm={currentDocForm}
            docLanguage={docLanguage}
            isActive={[ChunkingMode.text, ChunkingMode.qa].includes(currentDocForm)}
            isInUpload={isInUpload}
            isNotUploadInEmptyDataset={isNotUploadInEmptyDataset}
            hasCurrentDatasetDocForm={!!currentDataset?.doc_form}
            onSegmentIdentifierChange={value => segmentation.setSegmentIdentifier(value, true)}
            onMaxChunkLengthChange={segmentation.setMaxChunkLength}
            onOverlapChange={segmentation.setOverlap}
            onRuleToggle={segmentation.toggleRule}
            onDocFormChange={handleDocFormChange}
            onDocLanguageChange={setDocLanguage}
            onPreview={updatePreview}
            onReset={segmentation.resetToDefaults}
            locale={locale}
            showSummaryIndexSetting={showSummaryIndexSetting}
            summaryIndexSetting={segmentation.summaryIndexSetting}
            onSummaryIndexSettingChange={segmentation.handleSummaryIndexSettingChange}
          />
        )}
        {showParentChildOption && (
          <ParentChildOptions
            parentChildConfig={segmentation.parentChildConfig}
            rules={segmentation.rules}
            currentDocForm={currentDocForm}
            isActive={currentDocForm === ChunkingMode.parentChild}
            isInUpload={isInUpload}
            isNotUploadInEmptyDataset={isNotUploadInEmptyDataset}
            onDocFormChange={handleDocFormChange}
            onChunkForContextChange={segmentation.setChunkForContext}
            onParentDelimiterChange={v => segmentation.updateParentConfig('delimiter', v)}
            onParentMaxLengthChange={v => segmentation.updateParentConfig('maxLength', v)}
            onChildDelimiterChange={v => segmentation.updateChildConfig('delimiter', v)}
            onChildMaxLengthChange={v => segmentation.updateChildConfig('maxLength', v)}
            onRuleToggle={segmentation.toggleRule}
            onPreview={updatePreview}
            onReset={segmentation.resetToDefaults}
            showSummaryIndexSetting={showSummaryIndexSetting}
            summaryIndexSetting={segmentation.summaryIndexSetting}
            onSummaryIndexSettingChange={segmentation.handleSummaryIndexSettingChange}
          />
        )}
        <Divider className="my-5" />
        <IndexingModeSection
          indexType={indexing.indexType}
          hasSetIndexType={hasSetIndexType}
          docForm={docForm}
          embeddingModel={indexing.embeddingModel}
          embeddingModelList={indexing.embeddingModelList}
          retrievalConfig={indexing.retrievalConfig}
          showMultiModalTip={indexing.showMultiModalTip}
          isModelAndRetrievalConfigDisabled={isModelAndRetrievalConfigDisabled}
          datasetId={datasetId}
          isQAConfirmDialogOpen={isQAConfirmDialogOpen}
          onIndexTypeChange={indexing.setIndexType}
          onEmbeddingModelChange={indexing.setEmbeddingModel}
          onRetrievalConfigChange={indexing.setRetrievalConfig}
          onQAConfirmDialogClose={() => setIsQAConfirmDialogOpen(false)}
          onQAConfirmDialogConfirm={handleQAConfirm}
        />
        <StepTwoFooter isSetting={isSetting} isCreating={creation.isCreating} onPrevious={() => onStepChange?.(-1)} onCreate={handleCreate} onCancel={onCancel} />
      </div>
      <PreviewPanel
        isMobile={isMobile}
        dataSourceType={dataSourceType}
        currentDocForm={currentDocForm}
        estimate={estimateHook.estimate}
        parentChildConfig={segmentation.parentChildConfig}
        isSetting={isSetting}
        pickerFiles={preview.getPreviewPickerItems() as Array<{ id: string, name: string, extension: string }>}
        pickerValue={preview.getPreviewPickerValue()}
        isIdle={estimateHook.isIdle}
        isPending={estimateHook.isPending}
        onPickerChange={handlePickerChange}
      />
    </div>
  )
}

export default StepTwo
