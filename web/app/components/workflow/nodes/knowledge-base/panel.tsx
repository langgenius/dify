import type { FC } from 'react'
import type { KnowledgeBaseNodeType } from './types'
import type { NodePanelProps, Var } from '@/app/components/workflow/types'
import { useQuery } from '@tanstack/react-query'
import {
  memo,
  useCallback,
  useMemo,
} from 'react'
import { useTranslation } from 'react-i18next'
import SummaryIndexSetting from '@/app/components/datasets/settings/summary-index-setting'
import { checkShowMultiModalTip } from '@/app/components/datasets/settings/utils'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useModelList } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { useNodesReadOnly } from '@/app/components/workflow/hooks'
import {
  BoxGroup,
  BoxGroupField,
  Group,
} from '@/app/components/workflow/nodes/_base/components/layout'
import VarReferencePicker from '@/app/components/workflow/nodes/_base/components/variable/var-reference-picker'
import { IS_CE_EDITION } from '@/config'
import { consoleQuery } from '@/service/client'
import Split from '../_base/components/split'
import ChunkStructure from './components/chunk-structure'
import EmbeddingModel from './components/embedding-model'
import IndexMethod from './components/index-method'
import RetrievalSetting from './components/retrieval-setting'
import { useConfig } from './hooks/use-config'
import { useEmbeddingModelStatus } from './hooks/use-embedding-model-status'
import {
  ChunkStructureEnum,
  IndexMethodEnum,
} from './types'
import {
  getKnowledgeBaseValidationIssue,
  KnowledgeBaseValidationIssueCode,
} from './utils'

const Panel: FC<NodePanelProps<KnowledgeBaseNodeType>> = ({
  id,
  data,
}) => {
  const { t } = useTranslation()
  const { nodesReadOnly } = useNodesReadOnly()
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

  const {
    handleChunkStructureChange,
    handleIndexMethodChange,
    handleKeywordNumberChange,
    handleEmbeddingModelChange,
    handleRetrievalSearchMethodChange,
    handleHybridSearchModeChange,
    handleRerankingModelEnabledChange,
    handleWeighedScoreChange,
    handleRerankingModelChange,
    handleTopKChange,
    handleScoreThresholdChange,
    handleScoreThresholdEnabledChange,
    handleInputVariableChange,
    handleSummaryIndexSettingChange,
  } = useConfig(id)

  const filterVar = useCallback((variable: Var) => {
    if (!data.chunk_structure)
      return false
    switch (data.chunk_structure) {
      case ChunkStructureEnum.general:
        return variable.schemaType === 'general_structure' || variable.schemaType === 'multimodal_general_structure'
      case ChunkStructureEnum.parent_child:
        return variable.schemaType === 'parent_child_structure' || variable.schemaType === 'multimodal_parent_child_structure'
      case ChunkStructureEnum.question_answer:
        return variable.schemaType === 'qa_structure'
      default:
        return false
    }
  }, [data.chunk_structure])

  const chunkTypePlaceHolder = useMemo(() => {
    if (!data.chunk_structure)
      return ''
    let placeholder = ''
    switch (data.chunk_structure) {
      case ChunkStructureEnum.general:
        placeholder = '(multimodal_)general_structure'
        break
      case ChunkStructureEnum.parent_child:
        placeholder = '(multimodal_)parent_child_structure'
        break
      case ChunkStructureEnum.question_answer:
        placeholder = 'qa_structure'
        break
      default:
        return ''
    }
    return placeholder.charAt(0).toUpperCase() + placeholder.slice(1)
  }, [data.chunk_structure])

  const showMultiModalTip = useMemo(() => {
    return checkShowMultiModalTip({
      embeddingModel: {
        provider: data.embedding_model_provider ?? '',
        model: data.embedding_model ?? '',
      },
      rerankingEnable: !!data.retrieval_model?.reranking_enable,
      rerankModel: {
        rerankingProviderName: data.retrieval_model?.reranking_model?.reranking_provider_name ?? '',
        rerankingModelName: data.retrieval_model?.reranking_model?.reranking_model_name ?? '',
      },
      indexMethod: data.indexing_technique,
      embeddingModelList,
      rerankModelList,
    })
  }, [data.embedding_model_provider, data.embedding_model, data.retrieval_model?.reranking_enable, data.retrieval_model?.reranking_model, data.indexing_technique, embeddingModelList, rerankModelList])

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
    return getKnowledgeBaseValidationIssue(validationPayload)
  }, [validationPayload])
  const { status: embeddingModelStatus } = useEmbeddingModelStatus({
    embeddingModel,
    embeddingModelProvider,
    embeddingModelList,
  })

  const chunkStructureWarning = validationIssue?.code === KnowledgeBaseValidationIssueCode.chunkStructureRequired
  const chunksInputWarning = validationIssue?.code === KnowledgeBaseValidationIssueCode.chunksVariableRequired
  const embeddingModelWarning = indexingTechnique === IndexMethodEnum.QUALIFIED && embeddingModelStatus !== 'active'

  return (
    <div>
      <Group
        className="py-3"
        withBorderBottom={!!data.chunk_structure}
      >
        <ChunkStructure
          chunkStructure={data.chunk_structure}
          onChunkStructureChange={handleChunkStructureChange}
          warningDot={chunkStructureWarning}
          readonly={nodesReadOnly}
        />
      </Group>
      {
        !!data.chunk_structure && (
          <>
            <BoxGroupField
              boxGroupProps={{
                boxProps: { withBorderBottom: true },
              }}
              fieldProps={{
                fieldTitleProps: {
                  title: t('nodes.knowledgeBase.chunksInput', { ns: 'workflow' }),
                  tooltip: t('nodes.knowledgeBase.chunksInputTip', { ns: 'workflow' }),
                  warningDot: chunksInputWarning,
                },
              }}
            >
              <VarReferencePicker
                nodeId={id}
                isShowNodeName
                value={data.index_chunk_variable_selector}
                onChange={handleInputVariableChange}
                readonly={nodesReadOnly}
                filterVar={filterVar}
                isFilterFileVar
                isSupportFileVar={false}
                preferSchemaType
                typePlaceHolder={chunkTypePlaceHolder}
              />
            </BoxGroupField>
            <BoxGroup>
              <div className="space-y-3">
                <IndexMethod
                  chunkStructure={data.chunk_structure}
                  indexMethod={data.indexing_technique}
                  onIndexMethodChange={handleIndexMethodChange}
                  keywordNumber={data.keyword_number}
                  onKeywordNumberChange={handleKeywordNumberChange}
                  readonly={nodesReadOnly}
                />
                {
                  data.indexing_technique === IndexMethodEnum.QUALIFIED && (
                    <EmbeddingModel
                      embeddingModel={data.embedding_model}
                      embeddingModelProvider={data.embedding_model_provider}
                      onEmbeddingModelChange={handleEmbeddingModelChange}
                      warningDot={embeddingModelWarning}
                      readonly={nodesReadOnly}
                    />
                  )
                }
                <div className="pt-1">
                  <Split className="h-[1px]" />
                </div>
                {
                  data.indexing_technique === IndexMethodEnum.QUALIFIED
                  && [ChunkStructureEnum.general, ChunkStructureEnum.parent_child].includes(data.chunk_structure)
                  && IS_CE_EDITION && (
                    <>
                      <SummaryIndexSetting
                        summaryIndexSetting={data.summary_index_setting}
                        onSummaryIndexSettingChange={handleSummaryIndexSettingChange}
                        readonly={nodesReadOnly}
                      />
                      <div className="pt-1">
                        <Split className="h-[1px]" />
                      </div>
                    </>
                  )
                }
                <RetrievalSetting
                  indexMethod={data.indexing_technique}
                  searchMethod={data.retrieval_model.search_method}
                  onRetrievalSearchMethodChange={handleRetrievalSearchMethodChange}
                  hybridSearchMode={data.retrieval_model.reranking_mode}
                  onHybridSearchModeChange={handleHybridSearchModeChange}
                  weightedScore={data.retrieval_model.weights}
                  onWeightedScoreChange={handleWeighedScoreChange}
                  rerankingModelEnabled={data.retrieval_model.reranking_enable}
                  onRerankingModelEnabledChange={handleRerankingModelEnabledChange}
                  rerankingModel={data.retrieval_model.reranking_model}
                  onRerankingModelChange={handleRerankingModelChange}
                  topK={data.retrieval_model.top_k}
                  onTopKChange={handleTopKChange}
                  scoreThreshold={data.retrieval_model.score_threshold}
                  onScoreThresholdChange={handleScoreThresholdChange}
                  isScoreThresholdEnabled={data.retrieval_model.score_threshold_enabled}
                  onScoreThresholdEnabledChange={handleScoreThresholdEnabledChange}
                  showMultiModalTip={showMultiModalTip}
                  readonly={nodesReadOnly}
                />
              </div>
            </BoxGroup>
          </>
        )
      }
    </div>
  )
}

export default memo(Panel)
