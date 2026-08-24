'use client'

import type {
  EnvironmentVariableSlot,
  EnvVarValueSource,
} from '@dify/contracts/enterprise-app-deploy/types.gen'
import {
  EnvVarValueSource as EnvVarValueSourceEnum,
  EnvVarValueType,
} from '@dify/contracts/enterprise-app-deploy/types.gen'
import { Input } from '@langgenius/dify-ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectTrigger,
} from '@langgenius/dify-ui/select'
import { useTranslation } from 'react-i18next'

export function EnvironmentVariableField({
  slot,
  source,
  customValue,
  onSourceChange,
  onCustomValueChange,
}: {
  slot: EnvironmentVariableSlot
  source: EnvVarValueSource
  customValue: string
  onSourceChange: (source: EnvVarValueSource) => void
  onCustomValueChange: (value: string) => void
}) {
  const { t } = useTranslation('deployments')
  const sourceLabels: Partial<Record<EnvVarValueSource, string>> = {
    [EnvVarValueSourceEnum.ENV_VAR_VALUE_SOURCE_CONFIGURED]: t(($) => $['studio.versionValue']),
    [EnvVarValueSourceEnum.ENV_VAR_VALUE_SOURCE_CUSTOM]: t(
      ($) => $['deployDrawer.envVarSource.literal'],
    ),
    [EnvVarValueSourceEnum.ENV_VAR_VALUE_SOURCE_LAST_DEPLOYED]: t(
      ($) => $['deployDrawer.envVarSource.lastDeployment'],
    ),
  }
  const availableSources = [
    ...(slot.has_last_deployed_value
      ? [EnvVarValueSourceEnum.ENV_VAR_VALUE_SOURCE_LAST_DEPLOYED]
      : []),
    ...(slot.has_configured_value ? [EnvVarValueSourceEnum.ENV_VAR_VALUE_SOURCE_CONFIGURED] : []),
    EnvVarValueSourceEnum.ENV_VAR_VALUE_SOURCE_CUSTOM,
  ]
  const valueTypeLabel =
    slot.value_type === EnvVarValueType.ENV_VAR_VALUE_TYPE_NUMBER
      ? t(($) => $['deployDrawer.envVarType.number'])
      : slot.value_type === EnvVarValueType.ENV_VAR_VALUE_TYPE_SECRET
        ? t(($) => $['deployDrawer.envVarType.secret'])
        : t(($) => $['deployDrawer.envVarType.string'])
  const inputId = `deployment-env-${slot.key}`
  const editable = source === EnvVarValueSourceEnum.ENV_VAR_VALUE_SOURCE_CUSTOM
  const inputType =
    editable && slot.value_type === EnvVarValueType.ENV_VAR_VALUE_TYPE_SECRET
      ? 'password'
      : editable && slot.value_type === EnvVarValueType.ENV_VAR_VALUE_TYPE_NUMBER
        ? 'number'
        : 'text'
  const sourceLabel = sourceLabels[source] ?? t(($) => $['deployDrawer.envVarSource.literal'])
  // Secret values arrive masked, so these are safe to show as-is.
  const sourceValues: Partial<Record<EnvVarValueSource, string>> = {
    [EnvVarValueSourceEnum.ENV_VAR_VALUE_SOURCE_CONFIGURED]: slot.configured_value,
    [EnvVarValueSourceEnum.ENV_VAR_VALUE_SOURCE_LAST_DEPLOYED]: slot.last_deployed_value,
  }
  const placeholder = editable ? undefined : (sourceValues[source] ?? sourceLabel)

  return (
    <div className="flex flex-col gap-1">
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex min-w-0 grow items-center gap-1">
          <span
            aria-hidden
            className="i-custom-vender-line-others-env size-4 shrink-0 text-util-colors-violet-violet-600"
          />
          <label htmlFor={inputId} className="truncate system-sm-medium text-text-primary">
            {slot.key}
          </label>
          <span className="shrink-0 system-xs-regular text-text-tertiary">{valueTypeLabel}</span>
          {slot.value_type === EnvVarValueType.ENV_VAR_VALUE_TYPE_SECRET && (
            <span aria-hidden className="i-ri-lock-2-line size-3 shrink-0 text-text-tertiary" />
          )}
        </div>
        <Select
          value={source}
          onValueChange={(nextSource) => {
            if (nextSource) onSourceChange(nextSource)
          }}
        >
          <SelectTrigger
            aria-label={t(($) => $['deployDrawer.envVarSource.ariaLabel'], {
              key: slot.key,
            })}
            size="small"
            className="h-7 w-auto max-w-48 shrink-0 border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg px-2 shadow-xs backdrop-blur-[5px] hover:border-components-button-secondary-border-hover hover:bg-components-button-secondary-bg-hover focus-visible:bg-components-button-secondary-bg"
          >
            {sourceLabel}
          </SelectTrigger>
          <SelectContent placement="bottom-end" className="w-52">
            {availableSources.map((option) => (
              <SelectItem key={option} value={option}>
                <SelectItemText>{sourceLabels[option]}</SelectItemText>
                <SelectItemIndicator />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Input
        id={inputId}
        type={inputType}
        value={editable ? customValue : ''}
        placeholder={placeholder}
        disabled={!editable}
        autoComplete="off"
        onChange={(event) => onCustomValueChange(event.target.value)}
      />
      {slot.description && (
        <p className="system-xs-regular text-text-tertiary">{slot.description}</p>
      )}
    </div>
  )
}
