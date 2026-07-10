import type { ReactNode } from 'react'
import type {
  WeightedScore,
} from '../../types'
import type { RerankingModelSelectorProps } from './reranking-model-selector'
import type {
  TopKFieldProps,
  VisibleScoreThresholdFieldProps,
} from './top-k-and-score-threshold'
import type {
  HybridSearchModeOption,
  Option,
} from './type'
import { cn } from '@langgenius/dify-ui/cn'
import { Field, FieldItem, FieldLabel } from '@langgenius/dify-ui/field'
import { Fieldset, FieldsetLegend } from '@langgenius/dify-ui/fieldset'
import { RadioControl, RadioGroup, RadioItem } from '@langgenius/dify-ui/radio'
import { Switch } from '@langgenius/dify-ui/switch'
import { useTranslation } from 'react-i18next'
import WeightedScoreComponent from '@/app/components/app/configuration/dataset-config/params-config/weighted-score'
import Badge from '@/app/components/base/badge'
import {
  OptionCardEffectBlue,
  OptionCardEffectBlueLight,
  OptionCardEffectOrange,
  OptionCardEffectPurple,
  OptionCardEffectTeal,
} from '@/app/components/base/icons/src/public/knowledge'
import { Infotip } from '@/app/components/base/infotip'
import { DEFAULT_WEIGHTED_SCORE } from '@/models/datasets'
import {
  HybridSearchModeEnum,
  RetrievalSearchMethodEnum,
} from '../../types'
import RerankingModelSelector from './reranking-model-selector'
import { TopKAndScoreThreshold } from './top-k-and-score-threshold'

type HybridSearchConfig = {
  mode?: HybridSearchModeEnum
  options: HybridSearchModeOption[]
  onModeChange: (value: HybridSearchModeEnum) => void
  weightedScore?: WeightedScore
  onWeightedScoreChange: (value: { value: number[] }) => void
}

type RerankingConfig = RerankingModelSelectorProps & {
  enabled?: boolean
  onEnabledChange: (value: boolean) => void
  showMultiModalTip?: boolean
}

type RetrievalParametersConfig = {
  topK: TopKFieldProps
  scoreThreshold: VisibleScoreThresholdFieldProps
}

type SearchMethodRadioCardProps = {
  option: Option
  searchMethod?: RetrievalSearchMethodEnum
  readonly?: boolean
  isRecommended?: boolean
  children?: ReactNode
}

export type SearchMethodOptionProps = {
  readonly?: boolean
  option: Option
  searchMethod?: RetrievalSearchMethodEnum
  hybridSearch: HybridSearchConfig
  reranking: RerankingConfig
  retrievalParameters: RetrievalParametersConfig
}

const HEADER_EFFECT_MAP: Record<string, ReactNode> = {
  'blue': <OptionCardEffectBlue />,
  'blue-light': <OptionCardEffectBlueLight />,
  'orange': <OptionCardEffectOrange />,
  'purple': <OptionCardEffectPurple />,
  'teal': <OptionCardEffectTeal />,
}

function getWeightedScoreValue(weightedScore?: WeightedScore) {
  const semanticWeightedScore = weightedScore?.vector_setting.vector_weight ?? DEFAULT_WEIGHTED_SCORE.other.semantic
  const keywordWeightedScore = weightedScore?.keyword_setting.keyword_weight ?? DEFAULT_WEIGHTED_SCORE.other.keyword

  return {
    value: [semanticWeightedScore, keywordWeightedScore],
  }
}

function shouldShowRerankModelSelectorSwitch(searchMethod?: RetrievalSearchMethodEnum) {
  return searchMethod === RetrievalSearchMethodEnum.semantic || searchMethod === RetrievalSearchMethodEnum.fullText
}

function shouldShowRerankModelSelector(searchMethod: RetrievalSearchMethodEnum | undefined, hybridSearchMode: HybridSearchModeEnum | undefined) {
  if (shouldShowRerankModelSelectorSwitch(searchMethod))
    return true

  return searchMethod === RetrievalSearchMethodEnum.hybrid && hybridSearchMode !== HybridSearchModeEnum.WeightedScore
}

function getSearchMethodEffect(effectColor: string | undefined, isActive: boolean) {
  const effect = effectColor ? HEADER_EFFECT_MAP[effectColor] : undefined

  if (!effect)
    return null

  return (
    <div
      className={cn(
        'absolute -top-0.5 -left-0.5 hidden h-14 w-14 rounded-full',
        'group-hover/search-method-radio:block',
        isActive && 'block',
      )}
    >
      {effect}
    </div>
  )
}

function renderSearchMethodIcon(Icon: Option['icon'], isActive: boolean) {
  return (
    <Icon
      className={cn(
        'h-3.75 w-3.75 text-text-tertiary group-hover:text-util-colors-purple-purple-600',
        isActive && 'text-util-colors-purple-purple-600',
      )}
    />
  )
}

function SearchMethodRadioCard({
  option,
  searchMethod,
  readonly,
  isRecommended,
  children,
}: SearchMethodRadioCardProps) {
  const { t } = useTranslation()
  const isActive = option.id === searchMethod
  const Icon = option.icon

  return (
    <div
      className={cn(
        'group/search-method-radio overflow-hidden rounded-xl border border-components-option-card-option-border bg-components-option-card-option-bg',
        'has-data-checked:border-[1.5px] has-data-checked:border-components-option-card-option-selected-border',
        !readonly && 'cursor-pointer hover:shadow-xs',
        readonly && 'cursor-not-allowed',
      )}
    >
      <RadioItem<RetrievalSearchMethodEnum>
        value={option.id}
        nativeButton
        render={<button type="button" />}
        disabled={readonly}
        className={cn(
          'relative flex w-full rounded-t-xl p-2 text-left outline-hidden focus-visible:ring-1 focus-visible:ring-components-input-border-active',
          readonly ? 'cursor-not-allowed' : 'cursor-pointer',
        )}
      >
        {getSearchMethodEffect(option.effectColor, isActive)}
        <div className="mr-1 flex h-4.5 w-4.5 shrink-0 items-center justify-center">
          {renderSearchMethodIcon(Icon, isActive)}
        </div>
        <div className="grow py-1 pt-px">
          <div className="flex items-center">
            <div className="flex grow items-center system-sm-medium text-text-secondary">
              {option.title}
              {isRecommended
                ? (
                    <Badge className="ml-1 h-4 border-text-accent-secondary text-text-accent-secondary">
                      {t($ => $['stepTwo.recommend'], { ns: 'datasetCreation' })}
                    </Badge>
                  )
                : null}
            </div>
          </div>
          {option.description
            ? (
                <div className="mt-1 system-xs-regular text-text-tertiary">
                  {option.description}
                </div>
              )
            : null}
        </div>
      </RadioItem>
      {!!(children && isActive) && (
        <div className="relative rounded-b-xl bg-components-panel-bg p-3">
          <div className="absolute -top-2.75 left-3.5 i-custom-vender-knowledge-arrow-shape h-4 w-4 text-components-panel-bg" />
          {children}
        </div>
      )}
    </div>
  )
}

function HybridSearchModeRadioCard({
  option,
  readonly,
}: {
  option: HybridSearchModeOption
  readonly?: boolean
}) {
  return (
    <FieldItem>
      <RadioItem<HybridSearchModeEnum>
        value={option.id}
        nativeButton
        render={<button type="button" />}
        disabled={readonly}
        className={cn(
          'w-full rounded-xl border border-components-option-card-option-border bg-components-option-card-option-bg p-3 text-left outline-hidden transition-colors',
          'data-checked:border-[1.5px] data-checked:bg-components-option-card-option-selected-bg',
          'focus-visible:ring-1 focus-visible:ring-components-input-border-active',
          readonly ? 'cursor-not-allowed' : 'cursor-pointer hover:shadow-xs',
        )}
      >
        <div className="flex items-start gap-2">
          <div className="min-w-0 grow">
            <div className="system-sm-medium text-text-secondary">
              {option.title}
            </div>
            <div className="mt-1 system-xs-regular text-text-tertiary">
              {option.description}
            </div>
          </div>
          <RadioControl className="mt-0.5" aria-hidden="true" />
        </div>
      </RadioItem>
    </FieldItem>
  )
}

export function SearchMethodOption({
  readonly,
  option,
  searchMethod,
  hybridSearch,
  reranking,
  retrievalParameters,
}: SearchMethodOptionProps) {
  const { t } = useTranslation()
  const isHybridSearch = option.id === RetrievalSearchMethodEnum.hybrid
  const isHybridSearchWeightedScoreMode = hybridSearch.mode === HybridSearchModeEnum.WeightedScore
  const showRerankModelSelectorSwitch = shouldShowRerankModelSelectorSwitch(option.id)
  const showRerankModelSelector = shouldShowRerankModelSelector(option.id, hybridSearch.mode)
  const rerankModelLabel = t($ => $['modelProvider.rerankModel.key'], { ns: 'common' })
  const rerankModelTip = t($ => $['modelProvider.rerankModel.tip'], { ns: 'common' })
  const scoreThresholdHidden = option.id === RetrievalSearchMethodEnum.keywordSearch
  const config = (
    <div className="space-y-3">
      {isHybridSearch
        ? (
            <Field name="hybrid_search_mode" className="gap-0">
              <Fieldset
                render={(
                  <RadioGroup<HybridSearchModeEnum>
                    value={hybridSearch.mode}
                    onValueChange={value => hybridSearch.onModeChange(value)}
                    disabled={readonly}
                    className="flex-col items-stretch gap-1"
                  />
                )}
              >
                <FieldsetLegend className="sr-only">Hybrid search mode</FieldsetLegend>
                {hybridSearch.options.map(hybridOption => (
                  <HybridSearchModeRadioCard
                    key={hybridOption.id}
                    option={hybridOption}
                    readonly={readonly}
                  />
                ))}
              </Fieldset>
            </Field>
          )
        : null}
      {isHybridSearch && isHybridSearchWeightedScoreMode
        ? (
            <WeightedScoreComponent
              value={getWeightedScoreValue(hybridSearch.weightedScore)}
              onChange={hybridSearch.onWeightedScoreChange}
              readonly={readonly}
            />
          )
        : null}
      {showRerankModelSelector
        ? (
            <div>
              {showRerankModelSelectorSwitch
                ? (
                    <Field name="reranking_model_enabled" className="mb-1 gap-0">
                      <div className="flex items-center">
                        <FieldLabel className="flex min-w-0 items-center py-0 system-sm-semibold text-text-secondary">
                          <Switch
                            className="mr-1"
                            checked={reranking.enabled ?? false}
                            onCheckedChange={reranking.onEnabledChange}
                            disabled={readonly}
                          />
                          <span className="truncate">{rerankModelLabel}</span>
                        </FieldLabel>
                        <Infotip
                          aria-label={rerankModelTip}
                          className="ml-0.5 size-3.5 shrink-0"
                        >
                          {rerankModelTip}
                        </Infotip>
                      </div>
                    </Field>
                  )
                : null}
              <RerankingModelSelector
                rerankingModel={reranking.rerankingModel}
                onRerankingModelChange={reranking.onRerankingModelChange}
                readonly={readonly}
              />
              {reranking.showMultiModalTip
                ? (
                    <div className="mt-2 flex h-10 items-center gap-x-0.5 overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-2 shadow-xs backdrop-blur-[5px]">
                      <div className="absolute inset-0 bg-dataset-warning-message-bg opacity-40" />
                      <div className="p-1">
                        <div className="i-custom-vender-solid-alertsAndFeedback-alert-triangle size-4 text-text-warning-secondary" />
                      </div>
                      <span className="system-xs-medium text-text-primary">
                        {t($ => $['form.retrievalSetting.multiModalTip'], { ns: 'datasetSettings' })}
                      </span>
                    </div>
                  )
                : null}
            </div>
          )
        : null}
      <TopKAndScoreThreshold
        topK={retrievalParameters.topK}
        scoreThreshold={scoreThresholdHidden ? { hidden: true } : retrievalParameters.scoreThreshold}
        readonly={readonly}
      />
    </div>
  )

  return (
    <FieldItem>
      <SearchMethodRadioCard
        option={option}
        searchMethod={searchMethod}
        isRecommended={option.id === RetrievalSearchMethodEnum.hybrid}
        readonly={readonly}
      >
        {config}
      </SearchMethodRadioCard>
    </FieldItem>
  )
}
