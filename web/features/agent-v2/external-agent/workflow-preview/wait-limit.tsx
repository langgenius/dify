import type { ExternalAgentTimeoutAction, ExternalAgentWorkflowWaitLimit } from './types'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { Infotip, InfotipContent, InfotipTrigger } from '@langgenius/dify-ui/infotip'
import {
  NumberField,
  NumberFieldGroup,
  NumberFieldInput,
  NumberFieldUnit,
} from '@langgenius/dify-ui/number-field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@langgenius/dify-ui/select'
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

export function ExternalAgentWaitLimit({
  value,
  onChange,
}: {
  value: ExternalAgentWorkflowWaitLimit
  onChange: (changes: Partial<ExternalAgentWorkflowWaitLimit>) => void
}) {
  const { t } = useTranslation(['agentRoster'])
  const titleId = useId()
  const helpId = useId()
  const isRetry = value.on_timeout === 'cancel_and_retry'
  const hint = t(($) => $['external.workflow.waitLimit.tip'])
  const options = [
    { value: 'end_waiting' as const, label: t(($) => $['external.workflow.waitLimit.endWaiting']) },
    {
      value: 'request_cancellation' as const,
      label: t(($) => $['external.workflow.waitLimit.requestCancellation']),
    },
    {
      value: 'cancel_and_retry' as const,
      label: t(($) => $['external.workflow.waitLimit.cancelAndRetry']),
    },
  ]
  const help =
    value.on_timeout === 'request_cancellation'
      ? t(($) => $['external.workflow.waitLimit.cancellationHelp'])
      : isRetry
        ? t(($) => $['external.workflow.waitLimit.retryHelp'])
        : t(($) => $['external.workflow.waitLimit.help'])

  return (
    <section className="px-4 pt-4 pb-2">
      <Field name="external_agent_wait_limit_enabled" className="gap-0">
        <div className="flex min-h-6 items-center gap-1">
          <FieldLabel
            id={titleId}
            className="min-w-0 py-1 system-sm-semibold-uppercase text-text-secondary"
          >
            {t(($) => $['external.workflow.waitLimit.title'])}
          </FieldLabel>
          <Infotip>
            <InfotipTrigger aria-labelledby={titleId} />
            <InfotipContent aria-labelledby={titleId}>{hint}</InfotipContent>
          </Infotip>
          <Switch
            aria-labelledby={titleId}
            checked={value.enabled}
            onCheckedChange={(enabled) => onChange({ enabled })}
            className="ms-auto"
          />
        </div>
      </Field>
      {value.enabled && (
        <div className="mt-2 space-y-1">
          <WaitLimitNumberField
            name="external_agent_wait_limit_minutes"
            label={t(($) => $['external.workflow.waitLimit.label'])}
            unit={t(($) => $['external.workflow.waitLimit.unit'])}
            value={value.wait_seconds / 60}
            sliderMax={60}
            min={1}
            hint={isRetry ? hint : undefined}
            onValueChange={(minutes) => onChange({ wait_seconds: minutes * 60 })}
          />
          <Select<ExternalAgentTimeoutAction>
            items={options}
            value={value.on_timeout}
            onValueChange={(onTimeout) => {
              if (onTimeout !== null) onChange({ on_timeout: onTimeout })
            }}
          >
            <div className="flex min-h-8 items-center justify-between gap-2">
              <SelectLabel className="py-0 system-xs-medium text-text-tertiary uppercase">
                {t(($) => $['external.workflow.waitLimit.onTimeout'])}
              </SelectLabel>
              <SelectTrigger aria-describedby={helpId} className="w-50 shrink-0">
                <SelectValue />
              </SelectTrigger>
            </div>
            <SelectContent className="bg-components-panel-bg-blur backdrop-blur-sm">
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value} className="system-md-regular">
                  <SelectItemText>{option.label}</SelectItemText>
                  <SelectItemIndicator />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isRetry && (
            <>
              <WaitLimitNumberField
                name="external_agent_max_retries"
                label={t(($) => $['external.workflow.waitLimit.maxRetries'])}
                unit={t(($) => $['external.workflow.waitLimit.times'])}
                value={value.additional_retries}
                sliderMax={2}
                min={0}
                onValueChange={(additional_retries) => onChange({ additional_retries })}
              />
              <WaitLimitNumberField
                name="external_agent_retry_interval_seconds"
                label={t(($) => $['external.workflow.waitLimit.retryInterval'])}
                unit={t(($) => $['external.workflow.waitLimit.seconds'])}
                value={value.retry_interval_seconds}
                sliderMax={60}
                min={1}
                hint={t(($) => $['external.workflow.waitLimit.retryIntervalTip'])}
                onValueChange={(retry_interval_seconds) => onChange({ retry_interval_seconds })}
              />
            </>
          )}
          <p id={helpId} className="py-0.5 system-xs-regular text-text-tertiary">
            {help}
          </p>
        </div>
      )}
    </section>
  )
}

function WaitLimitNumberField({
  name,
  label,
  unit,
  value,
  sliderMax,
  min,
  hint,
  onValueChange,
}: {
  name: string
  label: string
  unit: string
  value: number
  sliderMax: number
  min: number
  hint?: string
  onValueChange: (value: number) => void
}) {
  const labelId = useId()
  const changeValue = (next: number | null) => {
    if (next !== null && Number.isInteger(next) && next >= min && next <= sliderMax)
      onValueChange(next)
  }
  return (
    <div className="flex min-h-8 items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-1">
        <span id={labelId} className="system-xs-medium text-text-tertiary uppercase">
          {label}
        </span>
        {hint && (
          <Infotip>
            <InfotipTrigger aria-labelledby={labelId} />
            <InfotipContent aria-labelledby={labelId}>{hint}</InfotipContent>
          </Infotip>
        )}
      </div>
      <div className="flex w-50 shrink-0 items-center gap-3">
        <Slider<number>
          value={value}
          min={min}
          max={sliderMax}
          step={1}
          onValueChange={changeValue}
          className="min-w-0 flex-1"
        >
          <SliderLabel className="sr-only">{label}</SliderLabel>
          <SliderControl>
            <SliderTrack>
              <SliderIndicator />
              <SliderThumb />
            </SliderTrack>
          </SliderControl>
        </Slider>
        <Field name={name} className="w-20 gap-0">
          <FieldLabel className="sr-only">{label}</FieldLabel>
          <NumberField
            value={value}
            min={min}
            max={sliderMax}
            step={1}
            format={{ useGrouping: false }}
            onValueChange={changeValue}
          >
            <NumberFieldGroup>
              <NumberFieldInput aria-labelledby={labelId} className="ps-3 pe-1" />
              <NumberFieldUnit>{unit}</NumberFieldUnit>
            </NumberFieldGroup>
          </NumberField>
        </Field>
      </div>
    </div>
  )
}
