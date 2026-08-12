'use client'

import type {
  DatasourceParameters,
  DatasourceParameterSchema,
  DatasourceParameterValue,
} from './datasource-parameter-model'
import {
  Field,
  FieldControl,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@langgenius/dify-ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectLabel,
  SelectTrigger,
} from '@langgenius/dify-ui/select'
import { Switch } from '@langgenius/dify-ui/switch'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { invalidDatasourceParameters, localizedDatasourceText } from './datasource-parameter-model'

function ParameterLabel({ label, required }: { label: string; required: boolean }) {
  return (
    <>
      {label}
      {required && (
        <span aria-hidden className="ml-0.5 text-text-destructive">
          *
        </span>
      )}
    </>
  )
}

function DatasourceParameterField({
  disabled,
  parameter,
  value,
  onChange,
}: {
  disabled: boolean
  parameter: DatasourceParameterSchema
  value: DatasourceParameterValue | undefined
  onChange: (value: DatasourceParameterValue | undefined) => void
}) {
  const { i18n, t } = useTranslation('dataset')
  const generatedId = useId()
  const [numberDraft, setNumberDraft] = useState<string>()
  const description = localizedDatasourceText(parameter.description, i18n.language, '')
  const descriptionId = description ? `${generatedId}-description` : undefined
  const errorId = `${generatedId}-error`
  const label =
    parameter.labelTranslationKey === 'newKnowledge.rootUrl'
      ? t(($) => $['newKnowledge.rootUrl'])
      : parameter.labelTranslationKey === 'newKnowledge.includeSubpages'
        ? t(($) => $['newKnowledge.includeSubpages'])
        : parameter.labelTranslationKey === 'newKnowledge.maxPages'
          ? t(($) => $['newKnowledge.maxPages'])
          : localizedDatasourceText(parameter.label, i18n.language, parameter.name)
  const placeholder = parameter.placeholderTranslationKey
    ? t(($) => $['newKnowledge.rootUrlPlaceholder'])
    : localizedDatasourceText(parameter.placeholder, i18n.language, '')
  const invalid = Boolean(
    (parameter.required && (value === undefined || (typeof value === 'string' && !value.trim()))) ||
    invalidDatasourceParameters([parameter], {
      ...(value === undefined ? {} : { [parameter.name]: value }),
    }).length,
  )
  const error = invalid
    ? parameter.name === 'url' && typeof value === 'string' && value
      ? t(($) => $['newKnowledge.invalidRootUrl'])
      : parameter.labelTranslationKey === 'newKnowledge.maxPages' &&
          parameter.min !== undefined &&
          parameter.max !== undefined
        ? `${label}: ${parameter.min}–${parameter.max}`
        : t(($) => $['newKnowledge.invalidDatasourceParameter'], { parameter: label })
    : undefined
  const describedBy =
    [descriptionId, error ? errorId : undefined].filter(Boolean).join(' ') || undefined
  const numberStep = parameter.integer
    ? 1
    : parameter.precision === undefined
      ? 'any'
      : 10 ** -parameter.precision

  if (parameter.type === 'unsupported')
    return (
      <Field name={parameter.name} className="gap-1.5" invalid>
        <FieldLabel>
          <ParameterLabel label={label} required={parameter.required} />
        </FieldLabel>
        <FieldDescription>{t(($) => $['newKnowledge.providerUnavailable'])}</FieldDescription>
      </Field>
    )

  if (parameter.type === 'boolean')
    return (
      <Field name={parameter.name} className="gap-1.5" invalid={invalid}>
        <div className="flex min-h-8 items-center justify-between gap-3">
          <FieldLabel htmlFor={generatedId}>
            <ParameterLabel label={label} required={parameter.required} />
          </FieldLabel>
          <Switch
            id={generatedId}
            checked={value === true}
            disabled={disabled}
            aria-describedby={describedBy}
            onCheckedChange={(checked) => onChange(checked)}
          />
        </div>
        {description && <FieldDescription id={descriptionId}>{description}</FieldDescription>}
        {error && (
          <FieldError id={errorId} match>
            {error}
          </FieldError>
        )}
      </Field>
    )

  if (parameter.type === 'select') {
    const selectedValue = typeof value === 'string' ? value : null
    return (
      <Field name={parameter.name} className="gap-1.5" invalid={invalid}>
        <Select<string | null>
          name={parameter.name}
          disabled={disabled}
          required={parameter.required}
          value={selectedValue}
          onValueChange={(nextValue) => onChange(nextValue ?? undefined)}
        >
          <SelectLabel>
            <ParameterLabel label={label} required={parameter.required} />
          </SelectLabel>
          <SelectTrigger aria-describedby={describedBy} size="large">
            {parameter.options.find((option) => option.value === selectedValue)
              ? localizedDatasourceText(
                  parameter.options.find((option) => option.value === selectedValue)?.label,
                  i18n.language,
                  selectedValue ?? '—',
                )
              : '—'}
          </SelectTrigger>
          <SelectContent>
            {!parameter.required && (
              <SelectItem value={null}>
                <SelectItemText>—</SelectItemText>
                <SelectItemIndicator />
              </SelectItem>
            )}
            {parameter.options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                <SelectItemText>
                  {localizedDatasourceText(option.label, i18n.language, option.value)}
                </SelectItemText>
                <SelectItemIndicator />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {description && <FieldDescription id={descriptionId}>{description}</FieldDescription>}
        {error && (
          <FieldError id={errorId} match>
            {error}
          </FieldError>
        )}
      </Field>
    )
  }

  return (
    <Field name={parameter.name} className="gap-1.5" invalid={invalid}>
      <FieldLabel>
        <ParameterLabel label={label} required={parameter.required} />
      </FieldLabel>
      <FieldControl
        aria-describedby={describedBy}
        autoComplete="off"
        disabled={disabled}
        inputMode={
          parameter.type === 'number'
            ? parameter.integer || parameter.precision === 0
              ? 'numeric'
              : 'decimal'
            : undefined
        }
        max={parameter.max}
        maxLength={parameter.name === 'url' ? 2048 : undefined}
        min={parameter.min}
        placeholder={placeholder || undefined}
        required={parameter.required}
        size="large"
        step={parameter.type === 'number' ? numberStep : undefined}
        type={parameter.type === 'number' ? 'number' : parameter.name === 'url' ? 'url' : 'text'}
        value={
          parameter.type === 'number' && numberDraft !== undefined
            ? numberDraft
            : value === undefined
              ? ''
              : String(value)
        }
        onValueChange={(nextValue) => {
          if (parameter.type === 'number') {
            setNumberDraft(nextValue)
            const number = Number(nextValue)
            onChange(nextValue && Number.isFinite(number) ? number : undefined)
            return
          }
          onChange(nextValue || undefined)
        }}
        onBlur={() => {
          if (parameter.type !== 'number' || numberDraft === undefined) return
          setNumberDraft(undefined)
        }}
      />
      {description && <FieldDescription id={descriptionId}>{description}</FieldDescription>}
      {error && (
        <FieldError id={errorId} match>
          {error}
        </FieldError>
      )}
    </Field>
  )
}

export function DatasourceParameterForm({
  disabled = false,
  parameters,
  schemas,
  onChange,
}: {
  disabled?: boolean
  parameters: DatasourceParameters
  schemas: DatasourceParameterSchema[]
  onChange: (parameters: DatasourceParameters) => void
}) {
  if (!schemas.length) return null

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {schemas.map((parameter) => (
        <DatasourceParameterField
          key={parameter.name}
          disabled={disabled}
          parameter={parameter}
          value={parameters[parameter.name]}
          onChange={(value) => {
            const next = { ...parameters }
            if (value === undefined) delete next[parameter.name]
            else next[parameter.name] = value
            onChange(next)
          }}
        />
      ))}
    </div>
  )
}
