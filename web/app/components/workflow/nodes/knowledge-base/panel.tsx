import type { FC } from 'react'
import {
  memo,
  useCallback,
  useMemo,
} from 'react'
import { useTranslation } from 'react-i18next'
import type { KnowledgeBaseNodeType } from './types'
import {
  ChunkStructureEnum,
  IndexMethodEnum,
} from './types'
import ChunkStructure from './components/chunk-structure'
import IndexMethod from './components/index-method'
import RetrievalSetting from './components/retrieval-setting'
import EmbeddingModel from './components/embedding-model'
import { useConfig } from './hooks/use-config'
import type { NodePanelProps } from '@/app/components/workflow/types'
import {
  BoxGroup,
  BoxGroupField,
  Group,
} from '@/app/components/workflow/nodes/_base/components/layout'
import Split from '../_base/components/split'
import { useNodesReadOnly } from '@/app/components/workflow/hooks'
import VarReferencePicker from '@/app/components/workflow/nodes/_base/components/variable/var-reference-picker'
import type { Var } from '@/app/components/workflow/types'

const Panel: FC<NodePanelProps<KnowledgeBaseNodeType>> = ({
  id,
  data,
}) => {
  const { t } = useTranslation()
  const { nodesReadOnly } = useNodesReadOnly()
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
  } = useConfig(id)

  const filterVar = useCallback((variable: Var) => {
    if (!data.chunk_structure) return false
    switch (data.chunk_structure) {
      case ChunkStructureEnum.general:
        return variable.schemaType === 'general_structure'
      case ChunkStructureEnum.parent_child:
        return variable.schemaType === 'parent_child_structure'
      case ChunkStructureEnum.question_answer:
        return variable.schemaType === 'qa_structure'
      default:
        return false
    }
  }, [data.chunk_structure])

  const chunkTypePlaceHolder = useMemo(() => {
    if (!data.chunk_structure) return ''
    let placeholder = ''
    switch (data.chunk_structure) {
      case ChunkStructureEnum.general:
        placeholder = 'general_structure'
        break
      case ChunkStructureEnum.parent_child:
        placeholder = 'parent_child_structure'
        break
      case ChunkStructureEnum.question_answer:
        placeholder = 'qa_structure'
        break
      default:
        return ''
    }
    return placeholder.charAt(0).toUpperCase() + placeholder.slice(1)
  }, [data.chunk_structure])

  return (
    <div>
      <Group
        className='py-3'
        withBorderBottom={!!data.chunk_structure}
      >
        <ChunkStructure
          chunkStructure={data.chunk_structure}
          onChunkStructureChange={handleChunkStructureChange}
          readonly={nodesReadOnly}
        />
      </Group>
      {
        data.chunk_structure && (
          <>
            <BoxGroupField
              boxGroupProps={{
                boxProps: { withBorderBottom: true },
              }}
              fieldProps={{
                fieldTitleProps: {
                  title: t('workflow.nodes.knowledgeBase.chunksInput'),
                  tooltip: t('workflow.nodes.knowledgeBase.chunksInputTip'),
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
              <div className='space-y-3'>
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
                      readonly={nodesReadOnly}
                    />
                  )
                }
                <div className='pt-1'>
                  <Split className='h-[1px]' />
                </div>
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
