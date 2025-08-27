import type { FC } from 'react'
import {
  memo,
  useCallback,
} from 'react'
import { useTranslation } from 'react-i18next'
import type { KnowledgeBaseNodeType } from './types'
import {
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
    handleWeighedScoreChange,
    handleRerankingModelChange,
    handleTopKChange,
    handleScoreThresholdChange,
    handleScoreThresholdEnabledChange,
    handleInputVariableChange,
  } = useConfig(id)

  const filterVar = useCallback((variable: Var) => {
    // console.log(variable.schemaType)
    // return variable.schemaType === 'aaa'
    return true
  }, [data.chunk_structure])

  return (
    <div>
      <BoxGroupField
        boxGroupProps={{
          boxProps: { withBorderBottom: true },
        }}
        fieldProps={{
          fieldTitleProps: {
            title: t('workflow.nodes.common.inputVars'),
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
        />
      </BoxGroupField>
      <Group
        className='py-3'
        withBorderBottom
      >
        <ChunkStructure
          chunkStructure={data.chunk_structure}
          onChunkStructureChange={handleChunkStructureChange}
          readonly={nodesReadOnly}
        />
      </Group>
      <BoxGroup>
        <div className='space-y-3'>
          {
            data.chunk_structure && (
              <>
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
              </>
            )
          }
          <RetrievalSetting
            indexMethod={data.indexing_technique}
            searchMethod={data.retrieval_model.search_method}
            onRetrievalSearchMethodChange={handleRetrievalSearchMethodChange}
            hybridSearchMode={data.retrieval_model.hybridSearchMode}
            onHybridSearchModeChange={handleHybridSearchModeChange}
            weightedScore={data.retrieval_model.weights}
            onWeightedScoreChange={handleWeighedScoreChange}
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
    </div>
  )
}

export default memo(Panel)
