import {
  memo,
  useCallback,
} from 'react'
import { Field } from '@/app/components/workflow/nodes/_base/components/layout'
import cn from '@/utils/classnames'
import WeightedScoreComponent from '@/app/components/app/configuration/dataset-config/params-config/weighted-score'
import { DEFAULT_WEIGHTED_SCORE } from '@/models/datasets'
import {
  HybridSearchModeEnum,
  RetrievalSearchMethodEnum,
} from '../../types'
import type {
  RerankingModel,
  WeightedScore,
} from '../../types'
import OptionCard from '../option-card'
import { useRetrievalSetting } from './hooks'
import type { Option } from './type'
import TopKAndScoreThreshold from './top-k-and-score-threshold'
import RerankingModelSelector from './reranking-model-selector'

type RetrievalSettingProps = {
  searchMethod: RetrievalSearchMethodEnum
  onRetrievalSearchMethodChange: (value: RetrievalSearchMethodEnum) => void
  hybridSearchMode: HybridSearchModeEnum
  onHybridSearchModeChange: (value: HybridSearchModeEnum) => void
  rerankingModel?: RerankingModel
  onRerankingModelChange: (model: RerankingModel) => void
  weightedScore?: WeightedScore
  onWeightedScoreChange: (value: { value: number[] }) => void
}
const RetrievalSetting = ({
  searchMethod,
  onRetrievalSearchMethodChange,
  hybridSearchMode,
  onHybridSearchModeChange,
  weightedScore,
  onWeightedScoreChange,
  rerankingModel,
  onRerankingModelChange,
}: RetrievalSettingProps) => {
  const {
    options,
    hybridSearchModeOptions,
  } = useRetrievalSetting()

  const renderOptionCard = useCallback((option: Option) => {
    const Icon = option.icon
    const isActive = searchMethod === option.id
    const isHybridSearch = searchMethod === RetrievalSearchMethodEnum.hybrid
    const isHybridSearchWeightedScoreMode = hybridSearchMode === HybridSearchModeEnum.WeightedScore
    const weightedScoreValue = (() => {
      const sematicWeightedScore = weightedScore?.vector_setting.vector_weight ?? DEFAULT_WEIGHTED_SCORE.other.semantic
      const keywordWeightedScore = weightedScore?.keyword_setting.keyword_weight ?? DEFAULT_WEIGHTED_SCORE.other.keyword
      const mergedValue = [sematicWeightedScore, keywordWeightedScore]

      return {
        value: mergedValue,
      }
    })()

    return (
      <OptionCard
        key={option.id}
        id={option.id}
        icon={
          <Icon
            className={cn(
              'h-[15px] w-[15px] text-text-tertiary',
              isActive && 'text-util-colors-purple-purple-600',
            )}
          />
        }
        title={option.title}
        description={option.description}
        effectColor={option.effectColor}
        isRecommended={option.id === RetrievalSearchMethodEnum.hybrid}
        onClick={onRetrievalSearchMethodChange}
        showChildren={isActive}
        showHighlightBorder={isActive}
        showEffectColor={isActive}
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
                      className='p-3'
                      title={hybridOption.title}
                      description={hybridOption.description}
                      showRadio
                      radioIsActive={hybridOption.id === hybridSearchMode}
                      onClick={onHybridSearchModeChange}
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
              />
            )
          }
          {
            !(isHybridSearch && hybridSearchMode === HybridSearchModeEnum.WeightedScore) && (
              <RerankingModelSelector
                rerankingModel={rerankingModel}
                onRerankingModelChange={onRerankingModelChange}
              />
            )
          }
          <TopKAndScoreThreshold />
        </div>
      </OptionCard>
    )
  }, [
    searchMethod,
    onRetrievalSearchMethodChange,
    hybridSearchModeOptions,
    hybridSearchMode,
    onHybridSearchModeChange,
    rerankingModel,
    onRerankingModelChange,
    weightedScore,
    onWeightedScoreChange,
  ])

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
        {options.map(renderOptionCard)}
      </div>
    </Field>
  )
}

export default memo(RetrievalSetting)
