import type { Node } from '@/app/components/workflow/types'
import { Fieldset, FieldsetLegend } from '@langgenius/dify-ui/fieldset'
import {
  NumberField,
  NumberFieldGroup,
  NumberFieldInput,
  NumberFieldUnit,
} from '@langgenius/dify-ui/number-field'
import {
  Slider,
  SliderControl,
  SliderIndicator,
  SliderLabel,
  SliderThumb,
  SliderTrack,
} from '@langgenius/dify-ui/slider'
import { Switch } from '@langgenius/dify-ui/switch'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import Split from '@/app/components/workflow/nodes/_base/components/split'
import { useRetryConfig } from './hooks'

type RetryOnPanelProps = Pick<Node, 'id' | 'data'>
const RetryOnPanel = ({ id, data }: RetryOnPanelProps) => {
  const { t } = useTranslation()
  const { handleRetryConfigChange } = useRetryConfig(id)
  const { retry_config } = data
  const retryEnabledId = useId()
  const retryOnFailureLabel = t(($) => $['nodes.common.retry.retryOnFailure'], {
    ns: 'workflow',
  })
  const maxRetriesLabel = t(($) => $['nodes.common.retry.maxRetries'], { ns: 'workflow' })
  const retryIntervalLabel = t(($) => $['nodes.common.retry.retryInterval'], { ns: 'workflow' })

  const handleRetryEnabledChange = (value: boolean) => {
    handleRetryConfigChange({
      retry_enabled: value,
      max_retries: retry_config?.max_retries || 3,
      retry_interval: retry_config?.retry_interval || 1000,
    })
  }

  const handleMaxRetriesChange = (value: number) => {
    if (value > 10) value = 10
    else if (value < 1) value = 1
    handleRetryConfigChange({
      retry_enabled: true,
      max_retries: value,
      retry_interval: retry_config?.retry_interval || 1000,
    })
  }

  const handleRetryIntervalChange = (value: number) => {
    if (value > 5000) value = 5000
    else if (value < 100) value = 100
    handleRetryConfigChange({
      retry_enabled: true,
      max_retries: retry_config?.max_retries || 3,
      retry_interval: value,
    })
  }

  return (
    <>
      <div className="pt-2">
        <div className="flex h-10 items-center justify-between px-4 py-2">
          <label
            htmlFor={retryEnabledId}
            className="mr-0.5 system-sm-semibold-uppercase text-text-secondary"
          >
            {retryOnFailureLabel}
          </label>
          <Switch
            id={retryEnabledId}
            checked={retry_config?.retry_enabled ?? false}
            onCheckedChange={(v) => handleRetryEnabledChange(v)}
          />
        </div>
        {retry_config?.retry_enabled && (
          <div className="px-4 pb-2">
            <Fieldset className="mb-1 flex w-full items-center">
              <FieldsetLegend className="sr-only">{maxRetriesLabel}</FieldsetLegend>
              <div className="mr-2 grow system-xs-medium-uppercase text-text-secondary">
                {maxRetriesLabel}
              </div>
              <Slider
                className="mr-3 w-27"
                value={retry_config?.max_retries || 3}
                onValueChange={handleMaxRetriesChange}
                min={1}
                max={10}
              >
                <SliderLabel className="sr-only">{maxRetriesLabel}</SliderLabel>
                <SliderControl>
                  <SliderTrack>
                    <SliderIndicator />
                    <SliderThumb
                      getAriaValueText={(_formattedValue, sliderValue) =>
                        `${sliderValue} ${t(($) => $['nodes.common.retry.times'], { ns: 'workflow' })}`
                      }
                    />
                  </SliderTrack>
                </SliderControl>
              </Slider>
              <NumberField
                className="w-25 shrink-0"
                value={retry_config?.max_retries || 3}
                min={1}
                max={10}
                format={{ useGrouping: false }}
                onValueChange={(value) => handleMaxRetriesChange(value ?? 3)}
              >
                <NumberFieldGroup>
                  <NumberFieldInput aria-label={maxRetriesLabel} />
                  <NumberFieldUnit>
                    {t(($) => $['nodes.common.retry.times'], { ns: 'workflow' })}
                  </NumberFieldUnit>
                </NumberFieldGroup>
              </NumberField>
            </Fieldset>
            <Fieldset className="flex items-center">
              <FieldsetLegend className="sr-only">{retryIntervalLabel}</FieldsetLegend>
              <div className="mr-2 grow system-xs-medium-uppercase text-text-secondary">
                {retryIntervalLabel}
              </div>
              <Slider
                className="mr-3 w-27"
                value={retry_config?.retry_interval || 1000}
                onValueChange={handleRetryIntervalChange}
                min={100}
                max={5000}
              >
                <SliderLabel className="sr-only">{retryIntervalLabel}</SliderLabel>
                <SliderControl>
                  <SliderTrack>
                    <SliderIndicator />
                    <SliderThumb
                      getAriaValueText={(_formattedValue, sliderValue) =>
                        `${sliderValue} ${t(($) => $['nodes.common.retry.ms'], { ns: 'workflow' })}`
                      }
                    />
                  </SliderTrack>
                </SliderControl>
              </Slider>
              <NumberField
                className="w-25 shrink-0"
                value={retry_config?.retry_interval || 1000}
                min={100}
                max={5000}
                format={{ useGrouping: false }}
                onValueChange={(value) => handleRetryIntervalChange(value ?? 1000)}
              >
                <NumberFieldGroup>
                  <NumberFieldInput aria-label={retryIntervalLabel} />
                  <NumberFieldUnit>
                    {t(($) => $['nodes.common.retry.ms'], { ns: 'workflow' })}
                  </NumberFieldUnit>
                </NumberFieldGroup>
              </NumberField>
            </Fieldset>
          </div>
        )}
      </div>
      <Split className="mx-4 mt-2" />
    </>
  )
}

export default RetryOnPanel
