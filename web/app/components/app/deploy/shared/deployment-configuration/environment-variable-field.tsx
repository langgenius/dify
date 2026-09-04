'use client'

import type {
  EnvironmentVariableSlot,
  EnvVarValueSource,
} from '@dify/contracts/enterprise-app-deploy/types.gen'
import type { EnvironmentVariableSelection } from './use-deployment-configuration-values'
import type { LLMEnvironmentVariableValue } from '@/app/components/workflow/types'
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
import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isLLMEnvironmentVariableValue } from '@/app/components/workflow/llm-environment-variable'
import dynamic from '@/next/dynamic'
import { resolveEnvironmentVariableSelection } from './utils/workflow-deployment-input'

const LLMEnvironmentVariableValueField = dynamic(
  () =>
    import('@/app/components/workflow/llm-environment-variable-value-field').then(
      (module) => module.LLMEnvironmentVariableValueField,
    ),
  {
    loading: () => (
      <div
        aria-hidden
        className="h-8 w-full animate-pulse rounded-lg bg-components-input-bg-normal"
      />
    ),
  },
)

function displayEnvironmentVariableValue(value: unknown) {
  if (value === undefined) return undefined
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)

  return JSON.stringify(value)
}

export const EnvironmentVariableField = memo(
  ({
    slot,
    workflowId,
    getInitialSelection,
    onChange,
  }: {
    slot: EnvironmentVariableSlot
    workflowId: string
    getInitialSelection: (
      workflowId: string,
      key: string,
    ) => EnvironmentVariableSelection | undefined
    onChange: (workflowId: string, key: string, value: EnvironmentVariableSelection) => void
  }) => {
    const { t } = useTranslation('deployments')
    const { t: tWorkflow } = useTranslation('workflow')
    const [selection, setSelection] = useState(() =>
      resolveEnvironmentVariableSelection(slot, getInitialSelection(workflowId, slot.key)),
    )
    const { customValue, source } = selection
    const isLLM = slot.value_type === EnvVarValueType.ENV_VAR_VALUE_TYPE_LLM
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
    const valueTypeLabel = isLLM
      ? tWorkflow(($) => $['blocks.llm'])
      : slot.value_type === EnvVarValueType.ENV_VAR_VALUE_TYPE_NUMBER
        ? t(($) => $['deployDrawer.envVarType.number'])
        : slot.value_type === EnvVarValueType.ENV_VAR_VALUE_TYPE_SECRET
          ? t(($) => $['deployDrawer.envVarType.secret'])
          : t(($) => $['deployDrawer.envVarType.string'])
    const inputId = `deployment-env-${encodeURIComponent(workflowId)}-${encodeURIComponent(slot.key)}`
    const labelId = `${inputId}-label`
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
      [EnvVarValueSourceEnum.ENV_VAR_VALUE_SOURCE_CONFIGURED]: displayEnvironmentVariableValue(
        slot.configured_value,
      ),
      [EnvVarValueSourceEnum.ENV_VAR_VALUE_SOURCE_LAST_DEPLOYED]: displayEnvironmentVariableValue(
        slot.last_deployed_value,
      ),
    }
    const placeholder = editable ? undefined : (sourceValues[source] ?? sourceLabel)
    const configuredLLMValue = isLLMEnvironmentVariableValue(slot.configured_value)
      ? slot.configured_value
      : undefined
    const lastDeployedLLMValue = isLLMEnvironmentVariableValue(slot.last_deployed_value)
      ? slot.last_deployed_value
      : undefined
    const llmSourceValues: Partial<Record<EnvVarValueSource, LLMEnvironmentVariableValue>> = {
      [EnvVarValueSourceEnum.ENV_VAR_VALUE_SOURCE_CONFIGURED]: configuredLLMValue,
      [EnvVarValueSourceEnum.ENV_VAR_VALUE_SOURCE_LAST_DEPLOYED]: lastDeployedLLMValue,
    }
    const displayedLLMValue = editable
      ? isLLMEnvironmentVariableValue(customValue)
        ? customValue
        : undefined
      : llmSourceValues[source]
    const requiredLLMMode = configuredLLMValue?.mode ?? lastDeployedLLMValue?.mode

    const updateSelection = (nextSelection: EnvironmentVariableSelection) => {
      setSelection(nextSelection)
      onChange(workflowId, slot.key, nextSelection)
    }

    return (
      <div className="flex flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex min-w-0 grow items-center gap-1">
            <span
              aria-hidden
              className="i-custom-vender-line-others-env size-4 shrink-0 text-util-colors-violet-violet-600"
            />
            {isLLM ? (
              <span id={labelId} className="truncate system-sm-medium text-text-primary">
                {slot.key}
              </span>
            ) : (
              <label htmlFor={inputId} className="truncate system-sm-medium text-text-primary">
                {slot.key}
              </label>
            )}
            <span className="shrink-0 system-xs-regular text-text-tertiary">{valueTypeLabel}</span>
            {slot.value_type === EnvVarValueType.ENV_VAR_VALUE_TYPE_SECRET && (
              <span aria-hidden className="i-ri-lock-2-line size-3 shrink-0 text-text-tertiary" />
            )}
          </div>
          <Select
            value={source}
            onValueChange={(nextSource) => {
              if (!nextSource) return

              const nextSelection = {
                ...selection,
                source: nextSource,
              }
              updateSelection(nextSelection)
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
        {isLLM ? (
          <div role="group" aria-labelledby={labelId} className="flex w-full min-w-0">
            <LLMEnvironmentVariableValueField
              disabled={!editable}
              requiredMode={requiredLLMMode}
              value={displayedLLMValue}
              onChange={(nextCustomValue) =>
                updateSelection({
                  ...selection,
                  customValue: nextCustomValue,
                })
              }
            />
          </div>
        ) : (
          <Input
            id={inputId}
            type={inputType}
            value={editable && typeof customValue === 'string' ? customValue : ''}
            placeholder={placeholder}
            disabled={!editable}
            autoComplete="off"
            onChange={(event) =>
              updateSelection({
                ...selection,
                customValue: event.target.value,
              })
            }
          />
        )}
        {slot.description && (
          <p className="system-xs-regular text-text-tertiary">{slot.description}</p>
        )}
      </div>
    )
  },
)
EnvironmentVariableField.displayName = 'EnvironmentVariableField'
