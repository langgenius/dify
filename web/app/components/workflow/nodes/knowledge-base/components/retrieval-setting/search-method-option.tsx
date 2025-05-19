import {
  memo,
  useCallback,
  useMemo,
} from 'react'
import cn from '@/utils/classnames'
import WeightedScoreComponent from '@/app/components/app/configuration/dataset-config/params-config/weighted-score'
import { DEFAULT_WEIGHTED_SCORE } from '@/models/datasets'
import {
  HybridSearchModeEnum,
  RetrievalSearchMethodEnum,
} from '../../types'
import type {
  WeightedScore,
} from '../../types'
import OptionCard from '../option-card'
import type {
  HybridSearchModeOption,
  Option,
} from './type'
import type { TopKAndScoreThresholdProps } from './top-k-and-score-threshold'
import TopKAndScoreThreshold from './top-k-and-score-threshold'
import type { RerankingModelSelectorProps } from './reranking-model-selector'
import RerankingModelSelector from './reranking-model-selector'

type SearchMethodOptionProps = {
  readonly?: boolean
  option: Option
  hybridSearchModeOptions: HybridSearchModeOption[]
  searchMethod: RetrievalSearchMethodEnum
  onRetrievalSearchMethodChange: (value: RetrievalSearchMethodEnum) => void
  hybridSearchMode: HybridSearchModeEnum
  onHybridSearchModeChange: (value: HybridSearchModeEnum) => void
  weightedScore?: WeightedScore
  onWeightedScoreChange: (value: { value: number[] }) => void
} & RerankingModelSelectorProps & TopKAndScoreThresholdProps
const SearchMethodOption = ({
  readonly,
  option,
  hybridSearchModeOptions,
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
}: SearchMethodOptionProps) => {
  const Icon = option.icon
  const isHybridSearch = option.id === RetrievalSearchMethodEnum.hybrid
  const isHybridSearchWeightedScoreMode = hybridSearchMode === HybridSearchModeEnum.WeightedScore

  const weightedScoreValue = useMemo(() => {
    const sematicWeightedScore = weightedScore?.vector_setting.vector_weight ?? DEFAULT_WEIGHTED_SCORE.other.semantic
    const keywordWeightedScore = weightedScore?.keyword_setting.keyword_weight ?? DEFAULT_WEIGHTED_SCORE.other.keyword
    const mergedValue = [sematicWeightedScore, keywordWeightedScore]

    return {
      value: mergedValue,
    }
  }, [weightedScore])

  const icon = useCallback((isActive: boolean) => {
    return (
      <Icon
        className={cn(
          'h-[15px] w-[15px] text-text-tertiary group-hover:text-util-colors-purple-purple-600',
          isActive && 'text-util-colors-purple-purple-600',
        )}
      />
    )
  }, [Icon])

  const hybridSearchModeWrapperClassName = useCallback((isActive: boolean) => {
    return isActive ? 'border-[1.5px] bg-components-option-card-option-selected-bg' : ''
  }, [])

  return (
    <OptionCard
      key={option.id}
      id={option.id}
      selectedId={searchMethod}
      icon={icon}
      title={option.title}
      description={option.description}
      effectColor={option.effectColor}
      isRecommended={option.id === RetrievalSearchMethodEnum.hybrid}
      onClick={onRetrievalSearchMethodChange}
      readonly={readonly}
    >
      <div className='space-y-3'>
        {
          isHybridSearch && (
            <div className='space-y-1'>
              {
                hybridSearchModeOptions.map(hybridOption => (
                  <OptionCard
                    key={hybridOption.id}
                    id={hybridOption.id}
                    selectedId={hybridSearchMode}
                    enableHighlightBorder={false}
                    enableRadio
                    wrapperClassName={hybridSearchModeWrapperClassName}
                    className='p-3'
                    title={hybridOption.title}
                    description={hybridOption.description}
                    onClick={onHybridSearchModeChange}
                    readonly={readonly}
                  />
                ))
              }
            </div>
          )
        }
        {
          isHybridSearch && isHybridSearchWeightedScoreMode && (
            <WeightedScoreComponent
              value={weightedScoreValue}
              onChange={onWeightedScoreChange}
              readonly={readonly}
            />
          )
        }
        {
          !(isHybridSearch && hybridSearchMode === HybridSearchModeEnum.WeightedScore) && (
            <RerankingModelSelector
              rerankingModel={rerankingModel}
              onRerankingModelChange={onRerankingModelChange}
              readonly={readonly}
            />
          )
        }
        <TopKAndScoreThreshold
          topK={topK}
          onTopKChange={onTopKChange}
          scoreThreshold={scoreThreshold}
          onScoreThresholdChange={onScoreThresholdChange}
          isScoreThresholdEnabled={isScoreThresholdEnabled}
          onScoreThresholdEnabledChange={onScoreThresholdEnabledChange}
          readonly={readonly}
        />
      </div>
    </OptionCard>
  )
}

export default memo(SearchMethodOption)
