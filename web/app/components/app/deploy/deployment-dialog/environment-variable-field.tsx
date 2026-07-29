'use client'

import type { MockEnvironmentVariable, MockEnvironmentVariableValueSource } from '../mock-data'
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

const ENVIRONMENT_VARIABLE_SOURCES: MockEnvironmentVariableValueSource[] = [
  'custom',
  'configured',
  'lastDeployed',
]

export function EnvironmentVariableField({
  variable,
  source,
  customValue,
  onSourceChange,
  onCustomValueChange,
}: {
  variable: MockEnvironmentVariable
  source: MockEnvironmentVariableValueSource
  customValue: string
  onSourceChange: (source: MockEnvironmentVariableValueSource) => void
  onCustomValueChange: (value: string) => void
}) {
  const { t } = useTranslation('deployments')
  const sourceLabels: Record<MockEnvironmentVariableValueSource, string> = {
    configured: t(($) => $['studio.configureValue']),
    custom: t(($) => $['deployDrawer.envVarSource.literal']),
    lastDeployed: t(($) => $['deployDrawer.envVarSource.lastDeployment']),
  }
  const valueTypeLabels: Record<MockEnvironmentVariable['valueType'], string> = {
    number: t(($) => $['deployDrawer.envVarType.number']),
    secret: t(($) => $['deployDrawer.envVarType.secret']),
    string: t(($) => $['deployDrawer.envVarType.string']),
  }
  const inputId = `deployment-env-${variable.key}`
  const editable = source === 'custom'
  const value =
    source === 'configured'
      ? variable.configuredValue
      : source === 'lastDeployed'
        ? variable.lastDeployedValue
        : customValue
  const inputType =
    editable && variable.valueType === 'secret'
      ? 'password'
      : editable && variable.valueType === 'number'
        ? 'number'
        : 'text'

  return (
    <div className="flex flex-col gap-1">
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex min-w-0 grow items-center gap-1">
          <span
            aria-hidden
            className="i-custom-vender-line-others-env size-4 shrink-0 text-util-colors-violet-violet-600"
          />
          <label htmlFor={inputId} className="truncate system-sm-medium text-text-primary">
            {variable.key}
          </label>
          <span className="shrink-0 system-xs-regular text-text-tertiary">
            {valueTypeLabels[variable.valueType]}
          </span>
          {variable.valueType === 'secret' && (
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
              key: variable.key,
            })}
            size="small"
            className="h-7 w-auto max-w-48 shrink-0 border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg px-2 shadow-xs backdrop-blur-[5px] hover:border-components-button-secondary-border-hover hover:bg-components-button-secondary-bg-hover focus-visible:bg-components-button-secondary-bg"
          >
            {sourceLabels[source]}
          </SelectTrigger>
          <SelectContent placement="bottom-end" popupClassName="w-52">
            {ENVIRONMENT_VARIABLE_SOURCES.map((option) => (
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
        value={value}
        disabled={!editable}
        autoComplete="off"
        onChange={(event) => onCustomValueChange(event.target.value)}
      />
      {variable.description && (
        <p className="system-xs-regular text-text-tertiary">{variable.description}</p>
      )}
    </div>
  )
}
