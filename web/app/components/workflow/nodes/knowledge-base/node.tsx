import type { FC } from 'react'
import type { KnowledgeBaseNodeType } from './types'
import type { NodeProps } from '@/app/components/workflow/types'
import { useQuery } from '@tanstack/react-query'
import {
  memo,
  useMemo,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  ModelTypeEnum,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import { DERIVED_MODEL_STATUS_BADGE_I18N } from '@/app/components/header/account-setting/model-provider-page/derive-model-status'
import {
  useLanguage,
  useModelList,
} from '@/app/components/header/account-setting/model-provider-page/hooks'
import { consoleQuery } from '@/service/client'
import { cn } from '@/utils/classnames'
import { useEmbeddingModelStatus } from './hooks/use-embedding-model-status'
import { useSettingsDisplay } from './hooks/use-settings-display'
import {
  IndexMethodEnum,
} from './types'
import {
  getKnowledgeBaseValidationIssue,
  getKnowledgeBaseValidationMessage,
  KnowledgeBaseValidationIssueCode,
} from './utils'

type SettingRowProps = {
  label: string
  value: string
  warning?: boolean
}

const SettingRow = memo(({
  label,
  value,
  warning = false,
}: SettingRowProps) => {
  return (
    <div
      className={cn(
        'flex h-6 items-center rounded-md px-1.5',
        warning
          ? 'border-[0.5px] border-state-warning-active bg-state-warning-hover'
          : 'bg-workflow-block-parma-bg',
      )}
    >
      <div className="mr-2 shrink-0 text-text-tertiary system-xs-medium-uppercase">
        {label}
      </div>
      <div
        className={cn('grow truncate text-right system-xs-medium', warning ? 'text-text-warning' : 'text-text-secondary')}
        title={value}
      >
        {value}
      </div>
    </div>
  )
})

const RETRIEVAL_WARNING_CODES = new Set<KnowledgeBaseValidationIssueCode>([
  KnowledgeBaseValidationIssueCode.retrievalSettingRequired,
  KnowledgeBaseValidationIssueCode.rerankingModelRequired,
  KnowledgeBaseValidationIssueCode.rerankingModelInvalid,
])

const Node: FC<NodeProps<KnowledgeBaseNodeType>> = ({ data }) => {
  const { t } = useTranslation()
  const language = useLanguage()
  const settingsDisplay = useSettingsDisplay()
  const { data: embeddingModelList } = useModelList(ModelTypeEnum.textEmbedding)
  const { data: rerankModelList } = useModelList(ModelTypeEnum.rerank)
  const chunkStructure = data.chunk_structure
  const indexChunkVariableSelector = data.index_chunk_variable_selector
  const indexingTechnique = data.indexing_technique
  const embeddingModel = data.embedding_model
  const retrievalModel = data.retrieval_model
  const retrievalSearchMethod = retrievalModel?.search_method
  const retrievalRerankingEnable = retrievalModel?.reranking_enable
  const embeddingModelProvider = data.embedding_model_provider
  const { data: embeddingProviderModelList } = useQuery(
    consoleQuery.modelProviders.models.queryOptions({
      input: { params: { provider: embeddingModelProvider || '' } },
      enabled: indexingTechnique === IndexMethodEnum.QUALIFIED && !!embeddingModelProvider,
      refetchOnWindowFocus: false,
      select: response => response.data,
    }),
  )

  const validationPayload = useMemo(() => {
    return {
      chunk_structure: chunkStructure,
      index_chunk_variable_selector: indexChunkVariableSelector,
      indexing_technique: indexingTechnique,
      embedding_model: embeddingModel,
      embedding_model_provider: embeddingModelProvider,
      retrieval_model: {
        search_method: retrievalSearchMethod,
        reranking_enable: retrievalRerankingEnable,
        reranking_model: retrievalModel?.reranking_model,
      },
      _embeddingModelList: embeddingModelList,
      _embeddingProviderModelList: embeddingProviderModelList,
      _rerankModelList: rerankModelList,
    }
  }, [
    chunkStructure,
    indexChunkVariableSelector,
    indexingTechnique,
    embeddingModel,
    embeddingModelProvider,
    retrievalSearchMethod,
    retrievalRerankingEnable,
    retrievalModel?.reranking_model,
    embeddingModelList,
    embeddingProviderModelList,
    rerankModelList,
  ])

  const validationIssue = useMemo(() => {
    return getKnowledgeBaseValidationIssue({
      ...validationPayload,
    })
  }, [validationPayload])

  const validationIssueMessage = useMemo(() => {
    return getKnowledgeBaseValidationMessage(validationIssue, t)
  }, [validationIssue, t])
  const { currentModel: currentEmbeddingModel, status: embeddingModelStatus } = useEmbeddingModelStatus({
    embeddingModel: data.embedding_model,
    embeddingModelProvider: data.embedding_model_provider,
    embeddingModelList,
  })

  const chunksDisplayValue = useMemo(() => {
    if (!data.index_chunk_variable_selector?.length)
      return '-'

    const chunkVar = data.index_chunk_variable_selector.at(-1)
    return chunkVar || '-'
  }, [data.index_chunk_variable_selector])

  const embeddingModelDisplay = useMemo(() => {
    if (data.indexing_technique !== IndexMethodEnum.QUALIFIED)
      return '-'

    if (embeddingModelStatus === 'empty')
      return t('detailPanel.configureModel', { ns: 'plugin' })

    if (embeddingModelStatus !== 'active') {
      const statusI18nKey = DERIVED_MODEL_STATUS_BADGE_I18N[embeddingModelStatus as keyof typeof DERIVED_MODEL_STATUS_BADGE_I18N]
      if (statusI18nKey)
        return t(statusI18nKey as 'modelProvider.selector.incompatible', { ns: 'common' })
    }

    return currentEmbeddingModel?.label[language] || currentEmbeddingModel?.label.en_US || data.embedding_model || '-'
  }, [currentEmbeddingModel, data.embedding_model, data.indexing_technique, embeddingModelStatus, language, t])

  const indexMethodDisplay = settingsDisplay[data.indexing_technique as keyof typeof settingsDisplay] || '-'
  const retrievalMethodDisplay = settingsDisplay[data.retrieval_model?.search_method as keyof typeof settingsDisplay] || '-'

  const chunksWarning = validationIssue?.code === KnowledgeBaseValidationIssueCode.chunksVariableRequired
  const indexMethodWarning = validationIssue?.code === KnowledgeBaseValidationIssueCode.indexMethodRequired
  const embeddingWarning = data.indexing_technique === IndexMethodEnum.QUALIFIED && embeddingModelStatus !== 'active'
  const showEmbeddingModelRow = data.indexing_technique === IndexMethodEnum.QUALIFIED
  const retrievalWarning = !!(validationIssue && RETRIEVAL_WARNING_CODES.has(validationIssue.code))

  if (!data.chunk_structure) {
    return (
      <div className="mb-1 space-y-0.5 px-3 py-1">
        <div className="flex h-6 items-center rounded-md border-[0.5px] border-state-warning-active bg-state-warning-hover px-1.5">
          <span className="mr-1 size-[4px] shrink-0 rounded-[2px] bg-text-warning-secondary" />
          <div className="grow truncate text-text-warning system-xs-medium" title={validationIssueMessage}>
            {validationIssueMessage}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="mb-1 space-y-0.5 px-3 py-1">
      <SettingRow
        label={t('nodes.knowledgeBase.chunksInput', { ns: 'workflow' })}
        value={chunksWarning ? validationIssueMessage : chunksDisplayValue}
        warning={chunksWarning}
      />
      <SettingRow
        label={t('stepTwo.indexMode', { ns: 'datasetCreation' })}
        value={indexMethodWarning ? validationIssueMessage : indexMethodDisplay}
        warning={indexMethodWarning}
      />
      {showEmbeddingModelRow && (
        <SettingRow
          label={t('form.embeddingModel', { ns: 'datasetSettings' })}
          value={embeddingModelDisplay}
          warning={embeddingWarning}
        />
      )}
      <SettingRow
        label={t('form.retrievalSetting.method', { ns: 'datasetSettings' })}
        value={retrievalWarning ? validationIssueMessage : retrievalMethodDisplay}
        warning={retrievalWarning}
      />
    </div>
  )
}

export default memo(Node)
