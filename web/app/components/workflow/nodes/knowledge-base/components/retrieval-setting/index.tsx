import {
  memo,
} from 'react'
import { Field } from '@/app/components/workflow/nodes/_base/components/layout'
import type {
  HybridSearchModeEnum,
  RetrievalSearchMethodEnum,
} from '../../types'
import type {
  WeightedScore,
} from '../../types'
import { useRetrievalSetting } from './hooks'
import type { TopKAndScoreThresholdProps } from './top-k-and-score-threshold'
import type { RerankingModelSelectorProps } from './reranking-model-selector'
import SearchMethodOption from './search-method-option'

type RetrievalSettingProps = {
  searchMethod: RetrievalSearchMethodEnum
  onRetrievalSearchMethodChange: (value: RetrievalSearchMethodEnum) => void
  hybridSearchMode: HybridSearchModeEnum
  onHybridSearchModeChange: (value: HybridSearchModeEnum) => void
  weightedScore?: WeightedScore
  onWeightedScoreChange: (value: { value: number[] }) => void
} & RerankingModelSelectorProps & TopKAndScoreThresholdProps

const RetrievalSetting = ({
  searchMethod,
  onRetrievalSearchMethodChange,
  hybridSearchMode,
  onHybridSearchModeChange,
  weightedScore,
  onWeightedScoreChange,
  rerankingModel,
  onRerankingModelChange,
  topK,
  onTopKChange,
  scoreThreshold,
  onScoreThresholdChange,
  isScoreThresholdEnabled,
  onScoreThresholdEnabledChange,
}: RetrievalSettingProps) => {
  const {
    options,
    hybridSearchModeOptions,
  } = useRetrievalSetting()

  return (
    <Field
      fieldTitleProps={{
        title: 'Retrieval Setting',
        subTitle: (
          <div className='body-xs-regular flex items-center text-text-tertiary'>
            <a
              href=''
              className='text-text-accent'
              target='_blank'
            >
              Learn more
            </a>
            &nbsp;
            about retrieval method.
          </div>
        ),
      }}
    >
      <div className='space-y-1'>
        {
          options.map(option => (
            <SearchMethodOption
              key={option.id}
              option={option}
              hybridSearchModeOptions={hybridSearchModeOptions}
              searchMethod={searchMethod}
              onRetrievalSearchMethodChange={onRetrievalSearchMethodChange}
              hybridSearchMode={hybridSearchMode}
              onHybridSearchModeChange={onHybridSearchModeChange}
              weightedScore={weightedScore}
              onWeightedScoreChange={onWeightedScoreChange}
              topK={topK}
              onTopKChange={onTopKChange}
              scoreThreshold={scoreThreshold}
              onScoreThresholdChange={onScoreThresholdChange}
              isScoreThresholdEnabled={isScoreThresholdEnabled}
              onScoreThresholdEnabledChange={onScoreThresholdEnabledChange}
              rerankingModel={rerankingModel}
              onRerankingModelChange={onRerankingModelChange}
            />
          ))
        }
      </div>
    </Field>
  )
}

export default memo(RetrievalSetting)
