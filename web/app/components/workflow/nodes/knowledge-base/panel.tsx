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

const Panel: FC<NodePanelProps<KnowledgeBaseNodeType>> = ({
  id,
  data,
}) => {
  const {
    handleChunkStructureChange,
    handleIndexMethodChange,
    handleKeywordNumberChange,
    handleRetrievalSearchMethodChange,
    handleHybridSearchModeChange,
    handleWeighedScoreChange,
    handleRerankingModelChange,
  } = useConfig(id)

  return (
    <div>
      <GroupWithBox boxProps={{ withBorderBottom: true }}>
        <InputVariable />
      </GroupWithBox>
      <Group
        className='py-3'
        withBorderBottom
      >
        <ChunkStructure
          chunkStructure={data.chunk_structure}
          onChunkStructureChange={handleChunkStructureChange}
        />
      </Group>
      <GroupWithBox>
        <div className='space-y-3'>
          <IndexMethod
            indexMethod={data.indexing_technique}
            onIndexMethodChange={handleIndexMethodChange}
            keywordNumber={data.keyword_number}
            onKeywordNumberChange={handleKeywordNumberChange}
          />
          {
            data.indexing_technique === IndexMethodEnum.QUALIFIED && (
              <EmbeddingModel />
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
          />
        </div>
      </GroupWithBox>
    </div>
  )
}

export default memo(Panel)
