'use client'

import type { EnvVarInput, EnvVarSlot } from '@dify/contracts/enterprise/types.gen'
import type { InputHTMLAttributes } from 'react'
import { EnvVarValueSource as ApiEnvVarValueSource } from '@dify/contracts/enterprise/types.gen'
import { cn } from '@langgenius/dify-ui/cn'
import { Input } from '@langgenius/dify-ui/input'
import { SegmentedControl, SegmentedControlItem } from '@langgenius/dify-ui/segmented-control'
import { TitleTooltip } from './title-tooltip'

export type EnvVarValueSource = NonNullable<EnvVarInput['valueSource']>
type EnvVarValueType = 'string' | 'number' | 'secret'
// Contract EnvVarSlot carries an EnvVarValueType enum and signals default/last
// presence via optional fields; binding slots keep the legacy lowercase value
// type plus explicit has* flags because DSL-metadata slots share this shape.
// Adapters live in env-var-bindings-utils.ts.
export type EnvVarBindingSlot = Omit<EnvVarSlot, 'valueType'> & {
  key: string
  valueType: EnvVarValueType
  hasDefaultValue?: boolean
  hasLastValue?: boolean
}
export type EnvVarValueSelection = {
  valueSource: EnvVarValueSource
  value?: string
}
export type EnvVarValues = Record<string, EnvVarValueSelection>
type EnvVarDefaultSourcePriority = 'dslDefault' | 'lastDeployment'

type EnvVarValueSourceOption = {
  value: EnvVarValueSource
  label: string
}

type EnvVarBindingsPanelProps = {
  slots: EnvVarBindingSlot[]
  values: EnvVarValues
  title: string
  hint: string
  envVarPlaceholder: string
  literalSourceLabel: string
  defaultSourceLabel: string
  lastDeploymentSourceLabel: string
  valueTypeLabels: Record<EnvVarValueType, string>
  sourceAriaLabel: (key: string) => string
  defaultSourcePriority?: EnvVarDefaultSourcePriority
  envVarCountLabel?: string
  missingRequiredLabel?: string
  showMissingRequired?: boolean
  listScrollable?: boolean
  onChange: (key: string, value: EnvVarValueSelection) => void
  className?: string
  listClassName?: string
}

const ENV_VAR_INPUT_TYPES = {
  string: 'text',
  number: 'number',
  secret: 'password',
} satisfies Record<EnvVarValueType, InputHTMLAttributes<HTMLInputElement>['type']>

function envVarInputId(index: number, key: string) {
  const safeKey = key.replace(/[^\w-]/g, '-')

  return `env-var-binding-${index}-${safeKey}`
}

function envVarValueSourceOptions(
  slot: EnvVarBindingSlot,
  labels: {
    literal: string
    defaultValue: string
    lastDeployment: string
  },
): EnvVarValueSourceOption[] {
  const options: EnvVarValueSourceOption[] = [
    {
      value: ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_LITERAL,
      label: labels.literal,
    },
  ]

  if (slot.hasDefaultValue) {
    options.push({
      value: ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_DSL_DEFAULT,
      label: labels.defaultValue,
    })
  }

  if (slot.hasLastValue) {
    options.push({
      value: ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_LAST_DEPLOYMENT,
      label: labels.lastDeployment,
    })
  }

  return options
}

export function EnvVarBindingsPanel({
  slots,
  values,
  title,
  hint,
  envVarPlaceholder,
  literalSourceLabel,
  defaultSourceLabel,
  lastDeploymentSourceLabel,
  valueTypeLabels,
  sourceAriaLabel,
  defaultSourcePriority,
  envVarCountLabel,
  missingRequiredLabel,
  showMissingRequired = false,
  listScrollable = true,
  onChange,
  className,
  listClassName,
}: EnvVarBindingsPanelProps) {
  if (slots.length === 0) return null

  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border border-divider-subtle bg-background-default-subtle',
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-0.5 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <div className="system-xs-medium-uppercase text-text-tertiary">{title}</div>
          <span className="shrink-0 rounded-md bg-background-default px-1.5 py-0.5 system-2xs-medium text-text-tertiary">
            {envVarCountLabel ?? slots.length}
          </span>
        </div>
        <span className="system-xs-regular text-text-tertiary">{hint}</span>
      </div>
      <div
        className={cn(
          'border-t border-divider-subtle',
          listScrollable ? 'max-h-[min(360px,34dvh)] overflow-y-auto' : 'overflow-visible',
          listClassName,
        )}
      >
        {slots.map((slot, index) => {
          const description = slot.description
          const inputId = envVarInputId(index, slot.key)
          const selection = values[slot.key]
          const defaultValueSource =
            defaultSourcePriority === 'lastDeployment' && slot.hasLastValue
              ? ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_LAST_DEPLOYMENT
              : slot.hasDefaultValue
                ? ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_DSL_DEFAULT
                : slot.hasLastValue
                  ? ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_LAST_DEPLOYMENT
                  : ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_LITERAL
          const valueSource = selection?.valueSource ?? defaultValueSource
          const invalidLiteralNumber =
            slot.valueType === 'number' && Number.isNaN(Number(selection?.value))
          const missing =
            showMissingRequired &&
            valueSource === ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_LITERAL &&
            (!selection?.value || invalidLiteralNumber)
          const sourceOptions = envVarValueSourceOptions(slot, {
            literal: literalSourceLabel,
            defaultValue: defaultSourceLabel,
            lastDeployment: lastDeploymentSourceLabel,
          })
          const isLiteralValue = valueSource === ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_LITERAL
          const displayValue =
            valueSource === ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_DSL_DEFAULT
              ? slot.defaultValue
              : valueSource === ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_LAST_DEPLOYMENT
                ? slot.lastValue
                : selection?.value

          return (
            <div
              key={slot.key}
              className="flex min-w-0 flex-col gap-2 border-b border-divider-subtle px-3 py-3 last:border-b-0"
            >
              <div className="flex min-w-0 flex-col gap-2.5">
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span
                      aria-hidden="true"
                      className="i-custom-vender-line-others-env size-4 shrink-0 text-util-colors-violet-violet-600"
                    />
                    <TitleTooltip content={slot.key}>
                      <label
                        className="truncate font-mono system-sm-semibold text-text-primary"
                        htmlFor={inputId}
                      >
                        {slot.key}
                      </label>
                    </TitleTooltip>
                    <span className="shrink-0 system-sm-medium text-text-tertiary">
                      {valueTypeLabels[slot.valueType]}
                    </span>
                    {slot.valueType === 'secret' && (
                      <span
                        aria-hidden="true"
                        className="i-ri-lock-2-line size-3 shrink-0 text-text-tertiary"
                      />
                    )}
                  </div>
                  {sourceOptions.length > 1 && (
                    <SegmentedControl<EnvVarValueSource>
                      aria-label={sourceAriaLabel(slot.key)}
                      value={[valueSource]}
                      onValueChange={(value) => {
                        const nextSource = value[0]
                        if (!nextSource) return
                        onChange(slot.key, {
                          value: selection?.value,
                          valueSource: nextSource,
                        })
                      }}
                      className="shrink-0"
                    >
                      {sourceOptions.map((option) => (
                        <SegmentedControlItem
                          key={option.value}
                          value={option.value}
                          className="px-2 system-xs-medium"
                        >
                          {option.label}
                        </SegmentedControlItem>
                      ))}
                    </SegmentedControl>
                  )}
                </div>
                {description && (
                  <TitleTooltip content={description}>
                    <div className="line-clamp-2 system-xs-regular text-text-tertiary">
                      {description}
                    </div>
                  </TitleTooltip>
                )}
                <Input
                  id={inputId}
                  type={ENV_VAR_INPUT_TYPES[slot.valueType]}
                  value={displayValue ?? ''}
                  onChange={(event) =>
                    onChange(slot.key, {
                      value: event.target.value,
                      valueSource: ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_LITERAL,
                    })
                  }
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
