import type {
  WeightedScore,
} from '../../types'
import type { RerankingModelSelectorProps } from './reranking-model-selector'
import type { TopKAndScoreThresholdProps } from './top-k-and-score-threshold'
import type {
  HybridSearchModeOption,
  Option,
} from './type'
import {
  memo,
  useCallback,
  useMemo,
} from 'react'
import { useTranslation } from 'react-i18next'
import WeightedScoreComponent from '@/app/components/app/configuration/dataset-config/params-config/weighted-score'
import { AlertTriangle } from '@/app/components/base/icons/src/vender/solid/alertsAndFeedback'
import Switch from '@/app/components/base/switch'
import Tooltip from '@/app/components/base/tooltip'
import { DEFAULT_WEIGHTED_SCORE } from '@/models/datasets'
import { cn } from '@/utils/classnames'
import {
  HybridSearchModeEnum,
  RetrievalSearchMethodEnum,
} from '../../types'
import OptionCard from '../option-card'
import RerankingModelSelector from './reranking-model-selector'
import TopKAndScoreThreshold from './top-k-and-score-threshold'

type SearchMethodOptionProps = {
  readonly?: boolean
  option: Option
  hybridSearchModeOptions: HybridSearchModeOption[]
  searchMethod?: RetrievalSearchMethodEnum
  onRetrievalSearchMethodChange: (value: RetrievalSearchMethodEnum) => void
  hybridSearchMode?: HybridSearchModeEnum
  onHybridSearchModeChange: (value: HybridSearchModeEnum) => void
  weightedScore?: WeightedScore
  onWeightedScoreChange: (value: { value: number[] }) => void
  rerankingModelEnabled?: boolean
  onRerankingModelEnabledChange?: (value: boolean) => void
  showMultiModalTip?: boolean
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
  rerankingModelEnabled,
  onRerankingModelEnabledChange,
  rerankingModel,
  onRerankingModelChange,
  topK,
  onTopKChange,
  scoreThreshold,
  onScoreThresholdChange,
  isScoreThresholdEnabled,
  onScoreThresholdEnabledChange,
  showMultiModalTip = false,
}: SearchMethodOptionProps) => {
  const { t } = useTranslation()
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

  const showRerankModelSelectorSwitch = useMemo(() => {
    if (searchMethod === RetrievalSearchMethodEnum.semantic)
      return true

    if (searchMethod === RetrievalSearchMethodEnum.fullText)
      return true

    return false
  }, [searchMethod])
  const showRerankModelSelector = useMemo(() => {
    if (searchMethod === RetrievalSearchMethodEnum.semantic)
      return true

    if (searchMethod === RetrievalSearchMethodEnum.fullText)
      return true

    if (searchMethod === RetrievalSearchMethodEnum.hybrid && hybridSearchMode !== HybridSearchModeEnum.WeightedScore)
      return true

    return false
  }, [hybridSearchMode, searchMethod])

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
      <div className="space-y-3">
        {
          isHybridSearch && (
            <div className="space-y-1">
              {
                hybridSearchModeOptions.map(hybridOption => (
                  <OptionCard
                    key={hybridOption.id}
                    id={hybridOption.id}
                    selectedId={hybridSearchMode}
                    enableHighlightBorder={false}
                    enableRadio
                    wrapperClassName={hybridSearchModeWrapperClassName}
                    className="p-3"
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
          showRerankModelSelector && (
            <div>
              {
                showRerankModelSelectorSwitch && (
                  <div className="system-sm-semibold mb-1 flex items-center text-text-secondary">
                    <Switch
                      className="mr-1"
                      defaultValue={rerankingModelEnabled}
                      onChange={onRerankingModelEnabledChange}
                      disabled={readonly}
                    />
                    {t('modelProvider.rerankModel.key', { ns: 'common' })}
                    <Tooltip
                      triggerClassName="ml-0.5 shrink-0 w-3.5 h-3.5"
                      popupContent={t('modelProvider.rerankModel.tip', { ns: 'common' })}
                    />
                  </div>
                )
              }
              <RerankingModelSelector
                rerankingModel={rerankingModel}
                onRerankingModelChange={onRerankingModelChange}
                readonly={readonly}
              />
              {showMultiModalTip && (
                <div className="mt-2 flex h-10 items-center gap-x-0.5 overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-2 shadow-xs backdrop-blur-[5px]">
                  <div className="absolute bottom-0 left-0 right-0 top-0 bg-dataset-warning-message-bg opacity-40" />
                  <div className="p-1">
                    <AlertTriangle className="size-4 text-text-warning-secondary" />
                  </div>
                  <span className="system-xs-medium text-text-primary">
                    {t('form.retrievalSetting.multiModalTip', { ns: 'datasetSettings' })}
                  </span>
                </div>
              )}
            </div>
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
          hiddenScoreThreshold={searchMethod === RetrievalSearchMethodEnum.keywordSearch}
        />
      </div>
    </OptionCard>
  )
}

export default memo(SearchMethodOption)
