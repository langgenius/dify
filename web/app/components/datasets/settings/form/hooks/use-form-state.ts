'use client'
import type { AppIconSelection } from '@/app/components/base/app-icon-picker'
import type { DefaultModel } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { Member } from '@/models/common'
import type { IconInfo, SummaryIndexSetting as SummaryIndexSettingType } from '@/models/datasets'
import type { RetrievalConfig } from '@/types/app'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Toast from '@/app/components/base/toast'
import { isReRankModelSelected } from '@/app/components/datasets/common/check-rerank-model'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useModelList } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { useSelector as useAppContextWithSelector } from '@/context/app-context'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { DatasetPermission } from '@/models/datasets'
import { updateDatasetSetting } from '@/service/datasets'
import { useInvalidDatasetList } from '@/service/knowledge/use-dataset'
import { useMembers } from '@/service/use-common'
import { checkShowMultiModalTip } from '../../utils'

const DEFAULT_APP_ICON: IconInfo = {
  icon_type: 'emoji',
  icon: '📙',
  icon_background: '#FFF4ED',
  icon_url: '',
}

export const useFormState = () => {
  const { t } = useTranslation()
  const isCurrentWorkspaceDatasetOperator = useAppContextWithSelector(state => state.isCurrentWorkspaceDatasetOperator)
  const currentDataset = useDatasetDetailContextWithSelector(state => state.dataset)
  const mutateDatasets = useDatasetDetailContextWithSelector(state => state.mutateDatasetRes)

  // Basic form state
  const [loading, setLoading] = useState(false)
  const [name, setName] = useState(currentDataset?.name ?? '')
  const [description, setDescription] = useState(currentDataset?.description ?? '')

  // Icon state
  const [iconInfo, setIconInfo] = useState(currentDataset?.icon_info || DEFAULT_APP_ICON)
  const [showAppIconPicker, setShowAppIconPicker] = useState(false)
  const previousAppIcon = useRef(DEFAULT_APP_ICON)

  // Permission state
  const [permission, setPermission] = useState(currentDataset?.permission)
  const [selectedMemberIDs, setSelectedMemberIDs] = useState<string[]>(currentDataset?.partial_member_list || [])

  // External retrieval state
  const [topK, setTopK] = useState(currentDataset?.external_retrieval_model.top_k ?? 2)
  const [scoreThreshold, setScoreThreshold] = useState(currentDataset?.external_retrieval_model.score_threshold ?? 0.5)
  const [scoreThresholdEnabled, setScoreThresholdEnabled] = useState(currentDataset?.external_retrieval_model.score_threshold_enabled ?? false)

  // Indexing and retrieval state
  const [indexMethod, setIndexMethod] = useState(currentDataset?.indexing_technique)
  const [keywordNumber, setKeywordNumber] = useState(currentDataset?.keyword_number ?? 10)
  const [retrievalConfig, setRetrievalConfig] = useState(currentDataset?.retrieval_model_dict as RetrievalConfig)
  const [embeddingModel, setEmbeddingModel] = useState<DefaultModel>(
    currentDataset?.embedding_model
      ? {
          provider: currentDataset.embedding_model_provider,
          model: currentDataset.embedding_model,
        }
      : {
          provider: '',
          model: '',
        },
  )

  // Summary index state
  const [summaryIndexSetting, setSummaryIndexSetting] = useState(currentDataset?.summary_index_setting)

  // Model lists
  const { data: rerankModelList } = useModelList(ModelTypeEnum.rerank)
  const { data: embeddingModelList } = useModelList(ModelTypeEnum.textEmbedding)
  const { data: membersData } = useMembers()
  const invalidDatasetList = useInvalidDatasetList()

  // Derive member list from API data
  const memberList = useMemo<Member[]>(() => {
    return membersData?.accounts ?? []
  }, [membersData])

  // Icon handlers
  const handleOpenAppIconPicker = useCallback(() => {
    setShowAppIconPicker(true)
    previousAppIcon.current = iconInfo
  }, [iconInfo])

  const handleSelectAppIcon = useCallback((icon: AppIconSelection) => {
    const newIconInfo: IconInfo = {
      icon_type: icon.type,
      icon: icon.type === 'emoji' ? icon.icon : icon.fileId,
      icon_background: icon.type === 'emoji' ? icon.background : undefined,
      icon_url: icon.type === 'emoji' ? undefined : icon.url,
    }
    setIconInfo(newIconInfo)
    setShowAppIconPicker(false)
  }, [])

  const handleCloseAppIconPicker = useCallback(() => {
    setIconInfo(previousAppIcon.current)
    setShowAppIconPicker(false)
  }, [])

  // External retrieval settings handler
  const handleSettingsChange = useCallback((data: { top_k?: number, score_threshold?: number, score_threshold_enabled?: boolean }) => {
    if (data.top_k !== undefined)
      setTopK(data.top_k)
    if (data.score_threshold !== undefined)
      setScoreThreshold(data.score_threshold)
    if (data.score_threshold_enabled !== undefined)
      setScoreThresholdEnabled(data.score_threshold_enabled)
  }, [])

  // Summary index setting handler
  const handleSummaryIndexSettingChange = useCallback((payload: SummaryIndexSettingType) => {
    setSummaryIndexSetting(prev => ({ ...prev, ...payload }))
  }, [])

  // Save handler
  const handleSave = async () => {
    if (loading)
      return

    if (!name?.trim()) {
      Toast.notify({ type: 'error', message: t('form.nameError', { ns: 'datasetSettings' }) })
      return
    }

    if (!isReRankModelSelected({ rerankModelList, retrievalConfig, indexMethod })) {
      Toast.notify({ type: 'error', message: t('datasetConfig.rerankModelRequired', { ns: 'appDebug' }) })
      return
    }

    if (retrievalConfig.weights) {
      retrievalConfig.weights.vector_setting.embedding_provider_name = embeddingModel.provider || ''
      retrievalConfig.weights.vector_setting.embedding_model_name = embeddingModel.model || ''
    }

    try {
      setLoading(true)
      const body: Record<string, unknown> = {
        name,
        icon_info: iconInfo,
        doc_form: currentDataset?.doc_form,
        description,
        permission,
        indexing_technique: indexMethod,
        retrieval_model: {
          ...retrievalConfig,
          score_threshold: retrievalConfig.score_threshold_enabled ? retrievalConfig.score_threshold : 0,
        },
        embedding_model: embeddingModel.model,
        embedding_model_provider: embeddingModel.provider,
        keyword_number: keywordNumber,
        summary_index_setting: summaryIndexSetting,
      }

      if (currentDataset!.provider === 'external') {
        body.external_knowledge_id = currentDataset!.external_knowledge_info.external_knowledge_id
        body.external_knowledge_api_id = currentDataset!.external_knowledge_info.external_knowledge_api_id
        body.external_retrieval_model = {
          top_k: topK,
          score_threshold: scoreThreshold,
          score_threshold_enabled: scoreThresholdEnabled,
        }
      }

      if (permission === DatasetPermission.partialMembers) {
        body.partial_member_list = selectedMemberIDs.map((id) => {
          return {
            user_id: id,
            role: memberList.find(member => member.id === id)?.role,
          }
        })
      }

      await updateDatasetSetting({ datasetId: currentDataset!.id, body })
      Toast.notify({ type: 'success', message: t('actionMsg.modifiedSuccessfully', { ns: 'common' }) })

      if (mutateDatasets) {
        await mutateDatasets()
        invalidDatasetList()
      }
    }
    catch {
      Toast.notify({ type: 'error', message: t('actionMsg.modifiedUnsuccessfully', { ns: 'common' }) })
    }
    finally {
      setLoading(false)
    }
  }

  // Computed values
  const showMultiModalTip = useMemo(() => {
    return checkShowMultiModalTip({
      embeddingModel,
      rerankingEnable: retrievalConfig.reranking_enable,
      rerankModel: {
        rerankingProviderName: retrievalConfig.reranking_model.reranking_provider_name,
        rerankingModelName: retrievalConfig.reranking_model.reranking_model_name,
      },
      indexMethod,
      embeddingModelList,
      rerankModelList,
    })
  }, [embeddingModel, rerankModelList, retrievalConfig.reranking_enable, retrievalConfig.reranking_model, embeddingModelList, indexMethod])

  return {
    // Context values
    currentDataset,
    isCurrentWorkspaceDatasetOperator,

    // Loading state
    loading,

    // Basic form
    name,
    setName,
    description,
    setDescription,

    // Icon
    iconInfo,
    showAppIconPicker,
    handleOpenAppIconPicker,
    handleSelectAppIcon,
    handleCloseAppIconPicker,

    // Permission
    permission,
    setPermission,
    selectedMemberIDs,
    setSelectedMemberIDs,
    memberList,

    // External retrieval
    topK,
    scoreThreshold,
    scoreThresholdEnabled,
    handleSettingsChange,

    // Indexing and retrieval
    indexMethod,
    setIndexMethod,
    keywordNumber,
    setKeywordNumber,
    retrievalConfig,
    setRetrievalConfig,
    embeddingModel,
    setEmbeddingModel,
    embeddingModelList,

    // Summary index
    summaryIndexSetting,
    handleSummaryIndexSettingChange,

    // Computed
    showMultiModalTip,

    // Actions
    handleSave,
  }
}
