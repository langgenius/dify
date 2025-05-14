import type { FC } from 'react'
import {
  memo,
} from 'react'
import type { KnowledgeBaseNodeType } from './types'
import {
  IndexMethodEnum,
} from './types'
import InputVariable from './components/input-variable'
import ChunkStructure from './components/chunk-structure'
import IndexMethod from './components/index-method'
import RetrievalSetting from './components/retrieval-setting'
import EmbeddingModel from './components/embedding-model'
import { useConfig } from './hooks/use-config'
import type { NodePanelProps } from '@/app/components/workflow/types'
import {
  Group,
  GroupWithBox,
} from '@/app/components/workflow/nodes/_base/components/layout'
import Split from '../_base/components/split'
import { useNodesReadOnly } from '@/app/components/workflow/hooks'

const Panel: FC<NodePanelProps<KnowledgeBaseNodeType>> = ({
  id,
  data,
}) => {
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

  return (
    <div>
      <GroupWithBox boxProps={{ withBorderBottom: true }}>
        <InputVariable
          nodeId={id}
          inputVariable={data.index_chunk_variable_selector}
          onInputVariableChange={handleInputVariableChange}
          readonly={nodesReadOnly}
        />
      </GroupWithBox>
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
      <GroupWithBox>
        <div className='space-y-3'>
          <IndexMethod
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
      </GroupWithBox>
    </div>
  )
}

export default memo(Panel)
