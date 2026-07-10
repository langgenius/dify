import { FieldLabel, FieldRoot } from '@langgenius/dify-ui/field'
import { FieldsetLegend, FieldsetRoot } from '@langgenius/dify-ui/fieldset'
import {
  NumberField,
  NumberFieldControls,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from '@langgenius/dify-ui/number-field'
import { Switch } from '@langgenius/dify-ui/switch'
import { useTranslation } from 'react-i18next'
import { Infotip } from '@/app/components/base/infotip'
import { env } from '@/env'

export type TopKFieldProps = {
  value: number
  onChange: (value: number) => void
}

export type VisibleScoreThresholdFieldProps = {
  hidden?: false
  value?: number
  onChange: (value: number) => void
  enabled?: boolean
  onEnabledChange: (value: boolean) => void
}

type ScoreThresholdFieldProps
  = | VisibleScoreThresholdFieldProps
    | {
      hidden: true
    }

export type TopKAndScoreThresholdProps = {
  topK: TopKFieldProps
  scoreThreshold: ScoreThresholdFieldProps
  readonly?: boolean
}

const TOP_K_VALUE_LIMIT = {
  step: 1,
  min: 1,
  max: env.NEXT_PUBLIC_TOP_K_MAX_VALUE,
}
const SCORE_THRESHOLD_VALUE_LIMIT = {
  step: 0.01,
  min: 0,
  max: 1,
}

export function TopKAndScoreThreshold({
  topK,
  scoreThreshold,
  readonly,
}: TopKAndScoreThresholdProps) {
  const { t } = useTranslation()
  const topKLabel = t($ => $['datasetConfig.top_k'], { ns: 'appDebug' })
  const scoreThresholdLabel = t($ => $['datasetConfig.score_threshold'], { ns: 'appDebug' })
  const topKTip = t($ => $['datasetConfig.top_kTip'], { ns: 'appDebug' })
  const scoreThresholdTip = t($ => $['datasetConfig.score_thresholdTip'], { ns: 'appDebug' })
  const scoreThresholdHidden = scoreThreshold.hidden === true
  const scoreThresholdEnabled = scoreThresholdHidden ? false : (scoreThreshold.enabled ?? false)

  return (
    <div className="grid grid-cols-2 gap-4">
      <FieldRoot name="top_k" className="gap-0">
        <div className="mb-0.5 flex h-6 items-center">
          <FieldLabel className="py-0 system-xs-medium text-text-secondary">
            {topKLabel}
          </FieldLabel>
          <Infotip
            aria-label={topKTip}
            className="ml-0.5 size-3.5"
            iconClassName="h-3.5 w-3.5"
          >
            {topKTip}
          </Infotip>
        </div>
        <NumberField
          disabled={readonly}
          step={TOP_K_VALUE_LIMIT.step}
          min={TOP_K_VALUE_LIMIT.min}
          max={TOP_K_VALUE_LIMIT.max}
          value={topK.value}
          onValueChange={value => topK.onChange(value ?? 0)}
        >
          <NumberFieldGroup>
            <NumberFieldInput />
            <NumberFieldControls>
              <NumberFieldIncrement />
              <NumberFieldDecrement />
            </NumberFieldControls>
          </NumberFieldGroup>
        </NumberField>
      </FieldRoot>
      {scoreThresholdHidden
        ? null
        : (
            <FieldsetRoot className="min-w-0">
              <FieldsetLegend className="sr-only">{scoreThresholdLabel}</FieldsetLegend>
              <FieldRoot name="score_threshold_enabled" className="mb-0.5 gap-0">
                <div className="flex h-6 items-center">
                  <FieldLabel className="flex w-full min-w-0 grow items-center py-0 system-sm-medium text-text-secondary">
                    <Switch
                      className="mr-2"
                      checked={scoreThresholdEnabled}
                      onCheckedChange={scoreThreshold.onEnabledChange}
                      disabled={readonly}
                    />
                    <span className="grow truncate">
                      {scoreThresholdLabel}
                    </span>
                  </FieldLabel>
                  <Infotip
                    aria-label={scoreThresholdTip}
                    className="ml-0.5 size-3.5"
                    iconClassName="h-3.5 w-3.5"
                  >
                    {scoreThresholdTip}
                  </Infotip>
                </div>
              </FieldRoot>
              <FieldRoot name="score_threshold" className="gap-0">
                <FieldLabel className="sr-only">{scoreThresholdLabel}</FieldLabel>
                <NumberField
                  disabled={readonly || !scoreThresholdEnabled}
                  step={SCORE_THRESHOLD_VALUE_LIMIT.step}
                  min={SCORE_THRESHOLD_VALUE_LIMIT.min}
                  max={SCORE_THRESHOLD_VALUE_LIMIT.max}
                  value={scoreThreshold.value ?? null}
                  onValueChange={value => scoreThreshold.onChange(value ?? 0)}
                >
                  <NumberFieldGroup>
                    <NumberFieldInput />
                    <NumberFieldControls>
                      <NumberFieldIncrement />
                      <NumberFieldDecrement />
                    </NumberFieldControls>
                  </NumberFieldGroup>
                </NumberField>
              </FieldRoot>
            </FieldsetRoot>
          )}
    </div>
  )
}
