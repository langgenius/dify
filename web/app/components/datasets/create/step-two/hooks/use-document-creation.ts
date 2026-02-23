import type { DefaultModel, Model } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { NotionPage } from '@/models/common'
import type {
  ChunkingMode,
  CrawlOptions,
  CrawlResultItem,
  CreateDocumentReq,
  createDocumentResponse,
  CustomFile,
  FullDocumentDetail,
  ProcessRule,
  SummaryIndexSetting as SummaryIndexSettingType,
} from '@/models/datasets'
import type { RetrievalConfig, RETRIEVE_METHOD } from '@/types/app'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { trackEvent } from '@/app/components/base/amplitude'
import Toast from '@/app/components/base/toast'
import { isReRankModelSelected } from '@/app/components/datasets/common/check-rerank-model'
import { DataSourceProvider } from '@/models/common'
import {
  DataSourceType,
} from '@/models/datasets'
import { getNotionInfo, getWebsiteInfo, useCreateDocument, useCreateFirstDocument } from '@/service/knowledge/use-create-dataset'
import { useInvalidDatasetList } from '@/service/knowledge/use-dataset'
import { IndexingType } from './use-indexing-config'
import { MAXIMUM_CHUNK_TOKEN_LENGTH } from './use-segmentation-state'

export type UseDocumentCreationOptions = {
  datasetId?: string
  isSetting?: boolean
  documentDetail?: FullDocumentDetail
  dataSourceType: DataSourceType
  files: CustomFile[]
  notionPages: NotionPage[]
  notionCredentialId: string
  websitePages: CrawlResultItem[]
  crawlOptions?: CrawlOptions
  websiteCrawlProvider?: DataSourceProvider
  websiteCrawlJobId?: string
  // Callbacks
  onStepChange?: (delta: number) => void
  updateIndexingTypeCache?: (type: string) => void
  updateResultCache?: (res: createDocumentResponse) => void
  updateRetrievalMethodCache?: (method: RETRIEVE_METHOD | '') => void
  onSave?: () => void
  mutateDatasetRes?: () => void
}

export type ValidationParams = {
  segmentationType: string
  maxChunkLength: number
  limitMaxChunkLength: number
  overlap: number
  indexType: IndexingType
  embeddingModel: DefaultModel
  rerankModelList: Model[]
  retrievalConfig: RetrievalConfig
}

export const useDocumentCreation = (options: UseDocumentCreationOptions) => {
  const { t } = useTranslation()
  const {
    datasetId,
    isSetting,
    documentDetail,
    dataSourceType,
    files,
    notionPages,
    notionCredentialId,
    websitePages,
    crawlOptions,
    websiteCrawlProvider = DataSourceProvider.jinaReader,
    websiteCrawlJobId = '',
    onStepChange,
    updateIndexingTypeCache,
    updateResultCache,
    updateRetrievalMethodCache,
    onSave,
    mutateDatasetRes,
  } = options

  const createFirstDocumentMutation = useCreateFirstDocument()
  const createDocumentMutation = useCreateDocument(datasetId!)
  const invalidDatasetList = useInvalidDatasetList()

  const isCreating = createFirstDocumentMutation.isPending || createDocumentMutation.isPending

  // Validate creation params
  const validateParams = useCallback((params: ValidationParams): boolean => {
    const {
      segmentationType,
      maxChunkLength,
      limitMaxChunkLength,
      overlap,
      indexType,
      embeddingModel,
      rerankModelList,
      retrievalConfig,
    } = params

    if (segmentationType === 'general' && overlap > maxChunkLength) {
      Toast.notify({ type: 'error', message: t('stepTwo.overlapCheck', { ns: 'datasetCreation' }) })
      return false
    }

    if (segmentationType === 'general' && maxChunkLength > limitMaxChunkLength) {
      Toast.notify({
        type: 'error',
        message: t('stepTwo.maxLengthCheck', { ns: 'datasetCreation', limit: limitMaxChunkLength }),
      })
      return false
    }

    if (!isSetting) {
      if (indexType === IndexingType.QUALIFIED && (!embeddingModel.model || !embeddingModel.provider)) {
        Toast.notify({
          type: 'error',
          message: t('datasetConfig.embeddingModelRequired', { ns: 'appDebug' }),
        })
        return false
      }

      if (!isReRankModelSelected({
        rerankModelList,
        retrievalConfig,
        indexMethod: indexType,
      })) {
        Toast.notify({ type: 'error', message: t('datasetConfig.rerankModelRequired', { ns: 'appDebug' }) })
        return false
      }
    }

    return true
  }, [t, isSetting])

  // Build creation params
  const buildCreationParams = useCallback((
    currentDocForm: ChunkingMode,
    docLanguage: string,
    processRule: ProcessRule,
    retrievalConfig: RetrievalConfig,
    embeddingModel: DefaultModel,
    indexingTechnique: string,
    summaryIndexSetting?: SummaryIndexSettingType,
  ): CreateDocumentReq | null => {
    if (isSetting) {
      return {
        original_document_id: documentDetail?.id,
        doc_form: currentDocForm,
        doc_language: docLanguage,
        process_rule: processRule,
        summary_index_setting: summaryIndexSetting,
        retrieval_model: retrievalConfig,
        embedding_model: embeddingModel.model,
        embedding_model_provider: embeddingModel.provider,
        indexing_technique: indexingTechnique,
      } as CreateDocumentReq
    }

    const params: CreateDocumentReq = {
      data_source: {
        type: dataSourceType,
        info_list: {
          data_source_type: dataSourceType,
        },
      },
      indexing_technique: indexingTechnique,
      process_rule: processRule,
      summary_index_setting: summaryIndexSetting,
      doc_form: currentDocForm,
      doc_language: docLanguage,
      retrieval_model: retrievalConfig,
      embedding_model: embeddingModel.model,
      embedding_model_provider: embeddingModel.provider,
    } as CreateDocumentReq

    // Add data source specific info
    if (dataSourceType === DataSourceType.FILE) {
      params.data_source!.info_list.file_info_list = {
        file_ids: files.map(file => file.id || '').filter(Boolean),
      }
    }
    if (dataSourceType === DataSourceType.NOTION)
      params.data_source!.info_list.notion_info_list = getNotionInfo(notionPages, notionCredentialId)

    if (dataSourceType === DataSourceType.WEB) {
      params.data_source!.info_list.website_info_list = getWebsiteInfo({
        websiteCrawlProvider,
        websiteCrawlJobId,
        websitePages,
        crawlOptions,
      })
    }

    return params
  }, [
    isSetting,
    documentDetail,
    dataSourceType,
    files,
    notionPages,
    notionCredentialId,
    websitePages,
    websiteCrawlProvider,
    websiteCrawlJobId,
    crawlOptions,
  ])

  // Execute creation
  const executeCreation = useCallback(async (
    params: CreateDocumentReq,
    indexType: IndexingType,
    retrievalConfig: RetrievalConfig,
  ) => {
    if (!datasetId) {
      await createFirstDocumentMutation.mutateAsync(params, {
        onSuccess(data) {
          updateIndexingTypeCache?.(indexType)
          updateResultCache?.(data)
          updateRetrievalMethodCache?.(retrievalConfig.search_method as RETRIEVE_METHOD)
        },
      })
    }
    else {
      await createDocumentMutation.mutateAsync(params, {
        onSuccess(data) {
          updateIndexingTypeCache?.(indexType)
          updateResultCache?.(data)
          updateRetrievalMethodCache?.(retrievalConfig.search_method as RETRIEVE_METHOD)
        },
      })
    }

    mutateDatasetRes?.()
    invalidDatasetList()

    trackEvent('create_datasets', {
      data_source_type: dataSourceType,
      indexing_technique: indexType,
    })

    onStepChange?.(+1)

    if (isSetting)
      onSave?.()
  }, [
    datasetId,
    createFirstDocumentMutation,
    createDocumentMutation,
    updateIndexingTypeCache,
    updateResultCache,
    updateRetrievalMethodCache,
    mutateDatasetRes,
    invalidDatasetList,
    dataSourceType,
    onStepChange,
    isSetting,
    onSave,
  ])

  // Validate preview params
  const validatePreviewParams = useCallback((maxChunkLength: number): boolean => {
    if (maxChunkLength > MAXIMUM_CHUNK_TOKEN_LENGTH) {
      Toast.notify({
        type: 'error',
        message: t('stepTwo.maxLengthCheck', { ns: 'datasetCreation', limit: MAXIMUM_CHUNK_TOKEN_LENGTH }),
      })
      return false
    }
    return true
  }, [t])

  return {
    isCreating,
    validateParams,
    buildCreationParams,
    executeCreation,
    validatePreviewParams,
  }
}

export type DocumentCreation = ReturnType<typeof useDocumentCreation>
