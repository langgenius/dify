'use client'

import type {
  DeploymentEnvVarSlot,
  EnvVarValueSelection,
  EnvVarValueSource,
  EnvVarValues,
} from './env-var-bindings-utils'
import { cn } from '@langgenius/dify-ui/cn'
import { Input } from '@langgenius/dify-ui/input'
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@langgenius/dify-ui/segmented-control'
import {
  ENV_VAR_VALUE_SOURCE_DSL_DEFAULT,
  ENV_VAR_VALUE_SOURCE_LAST_DEPLOYMENT,
  ENV_VAR_VALUE_SOURCE_LITERAL,
  envVarSlotKey,
  envVarValueSelectionForSlot,
  hasMissingRequiredEnvVarValue,
  hasEnvVarDefaultValue,
  hasEnvVarLastValue,
} from './env-var-bindings-utils'
import { TitleTooltip } from './title-tooltip'

type EnvVarValueSourceOption = {
  value: EnvVarValueSource
  label: string
}

type EnvVarBindingsPanelProps = {
  slots: DeploymentEnvVarSlot[]
  values: EnvVarValues
  title: string
  hint: string
  requiredLabel: string
  envVarPlaceholder: string
  literalSourceLabel: string
  defaultSourceLabel: string
  lastDeploymentSourceLabel: string
  sourceAriaLabel: (key: string) => string
  envVarCountLabel?: string
  missingRequiredLabel?: string
  showMissingRequired?: boolean
  listScrollable?: boolean
  onChange: (key: string, value: EnvVarValueSelection) => void
  className?: string
  listClassName?: string
}

function envVarInputId(index: number, key: string) {
  const safeKey = key.replace(/[^\w-]/g, '-')

  return `env-var-binding-${index}-${safeKey}`
}

function envVarValueSourceOptions(slot: DeploymentEnvVarSlot, labels: {
  literal: string
  defaultValue: string
  lastDeployment: string
}): EnvVarValueSourceOption[] {
  const options: EnvVarValueSourceOption[] = [
    {
      value: ENV_VAR_VALUE_SOURCE_LITERAL,
      label: labels.literal,
    },
  ]

  if (hasEnvVarDefaultValue(slot)) {
    options.push({
      value: ENV_VAR_VALUE_SOURCE_DSL_DEFAULT,
      label: labels.defaultValue,
    })
  }

  if (hasEnvVarLastValue(slot)) {
    options.push({
      value: ENV_VAR_VALUE_SOURCE_LAST_DEPLOYMENT,
      label: labels.lastDeployment,
    })
  }

  return options
}

function envVarSelectionDisplayValue(slot: DeploymentEnvVarSlot, selection: EnvVarValueSelection) {
  if (selection.valueSource === ENV_VAR_VALUE_SOURCE_DSL_DEFAULT)
    return slot.maskedDefaultValue ?? slot.defaultValue ?? ''
  if (selection.valueSource === ENV_VAR_VALUE_SOURCE_LAST_DEPLOYMENT)
    return slot.maskedLastValue ?? ''

  return selection.value ?? ''
}

export function EnvVarBindingsPanel({
  slots,
  values,
  title,
  hint,
  requiredLabel,
  envVarPlaceholder,
  literalSourceLabel,
  defaultSourceLabel,
  lastDeploymentSourceLabel,
  sourceAriaLabel,
  envVarCountLabel,
  missingRequiredLabel,
  showMissingRequired = false,
  listScrollable = true,
  onChange,
  className,
  listClassName,
}: EnvVarBindingsPanelProps) {
  if (slots.length === 0)
    return null

  return (
    <div className={cn('overflow-hidden rounded-xl border border-divider-subtle bg-background-default-subtle', className)}>
      <div className="flex min-w-0 flex-col gap-0.5 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <div className="system-xs-medium-uppercase text-text-tertiary">{title}</div>
          <span className="shrink-0 rounded-md bg-background-default px-1.5 py-0.5 system-2xs-medium text-text-quaternary">
            {envVarCountLabel ?? slots.length}
          </span>
        </div>
        <span className="system-xs-regular text-text-quaternary">{hint}</span>
      </div>
      <div
        className={cn(
          'border-t border-divider-subtle',
          listScrollable ? 'max-h-[min(360px,34dvh)] overflow-y-auto' : 'overflow-visible',
          listClassName,
        )}
      >
        {slots.map((slot, index) => {
          const key = envVarSlotKey(slot)
          const description = slot.description?.trim()
          const inputId = envVarInputId(index, key)
          const missing = showMissingRequired && hasMissingRequiredEnvVarValue(slot, values)
          const selection = envVarValueSelectionForSlot(slot, values[key])
          const sourceOptions = envVarValueSourceOptions(slot, {
            literal: literalSourceLabel,
            defaultValue: defaultSourceLabel,
            lastDeployment: lastDeploymentSourceLabel,
          })
          const isLiteralValue = selection.valueSource === ENV_VAR_VALUE_SOURCE_LITERAL
          const displayValue = envVarSelectionDisplayValue(slot, selection)

          return (
            <div key={key} className="flex min-w-0 flex-col gap-2 border-b border-divider-subtle px-3 py-3 last:border-b-0">
              <div className="flex min-w-0 flex-col gap-2.5">
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <TitleTooltip content={key}>
                      <label className="truncate font-mono system-sm-semibold text-text-primary" htmlFor={inputId}>
                        {key}
                      </label>
                    </TitleTooltip>
                    <span className="shrink-0 rounded-md bg-background-default px-1.5 py-0.5 system-2xs-medium-uppercase text-text-tertiary">
                      {requiredLabel}
                    </span>
                  </div>
                  {sourceOptions.length > 1 && (
                    <SegmentedControl<EnvVarValueSource>
                      aria-label={sourceAriaLabel(key)}
                      value={[selection.valueSource]}
                      onValueChange={(value) => {
                        const nextSource = value[0]
                        if (!nextSource)
                          return
                        onChange(key, {
                          ...selection,
                          valueSource: nextSource,
                        })
                      }}
                      className="shrink-0"
                    >
                      {sourceOptions.map(option => (
                        <SegmentedControlItem key={option.value} value={option.value} className="px-2 system-xs-medium">
                          {option.label}
                        </SegmentedControlItem>
                      ))}
                    </SegmentedControl>
                  )}
                </div>
                {description && (
                  <div className="system-xs-regular text-text-tertiary">
                    {description}
                  </div>
                )}
                <Input
                  id={inputId}
                  value={displayValue}
                  onChange={event => onChange(key, {
                    ...selection,
                    value: event.target.value,
                    valueSource: ENV_VAR_VALUE_SOURCE_LITERAL,
                  })}
                  placeholder={envVarPlaceholder}
                  autoComplete="off"
                  disabled={!isLiteralValue}
                  required
                  className="h-8"
                />
              </div>
              {missing && missingRequiredLabel && (
                <div className="system-xs-regular text-text-destructive">
                  {missingRequiredLabel}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
