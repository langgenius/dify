'use client'

import type { ReactNode } from 'react'
import type {
  DatasourceParameters,
  DatasourceParameterSchema,
  DatasourceParameterValue,
} from './datasource-parameter-model'
import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { cn } from '@langgenius/dify-ui/cn'
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@langgenius/dify-ui/collapsible'
import { Field, FieldDescription, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { Input } from '@langgenius/dify-ui/input'
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
import {
  datasourceParameterDefaults,
  invalidDatasourceParameters,
  localizedDatasourceText,
} from './datasource-parameter-model'

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
  booleanControl = 'switch',
  disabled,
  parameter,
  showDescription = true,
  value,
  onChange,
}: {
  booleanControl?: 'checkbox' | 'switch'
  disabled: boolean
  parameter: DatasourceParameterSchema
  showDescription?: boolean
  value: DatasourceParameterValue | undefined
  onChange: (value: DatasourceParameterValue | undefined) => void
}) {
  const { i18n, t } = useTranslation('dataset')
  const generatedId = useId()
  const [numberDraft, setNumberDraft] = useState<string>()
  const [touched, setTouched] = useState(false)
  const description = showDescription
    ? localizedDatasourceText(parameter.description, i18n.language, '')
    : ''
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
  const showError = touched && invalid
  const error = showError
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
      <Field name={parameter.name} className="gap-1.5" invalid={showError}>
        <FieldLabel>
          <ParameterLabel label={label} required={parameter.required} />
        </FieldLabel>
        <FieldDescription>{t(($) => $['newKnowledge.providerUnavailable'])}</FieldDescription>
      </Field>
    )

  if (parameter.type === 'boolean' && booleanControl === 'checkbox')
    return (
      <Field name={parameter.name} className="gap-1.5" invalid={showError}>
        <FieldLabel
          htmlFor={generatedId}
          className={cn(
            'flex cursor-pointer items-start gap-2 py-0 font-normal',
            disabled && 'cursor-not-allowed',
          )}
        >
          <Checkbox
            id={generatedId}
            className="mt-0.5"
            checked={value === true}
            disabled={disabled}
            aria-describedby={describedBy}
            onCheckedChange={(checked) => {
              setTouched(true)
              onChange(checked)
            }}
          />
          <span className="min-w-0 flex-1">
            <span className="block system-xs-medium text-text-primary">
              <ParameterLabel label={label} required={parameter.required} />
            </span>
            {description && (
              <span id={descriptionId} className="mt-0.5 block body-xs-regular text-text-tertiary">
                {description}
              </span>
            )}
          </span>
        </FieldLabel>
        {error && (
          <FieldError id={errorId} match>
            {error}
          </FieldError>
        )}
      </Field>
    )

  if (parameter.type === 'boolean')
    return (
      <Field
        name={parameter.name}
        className="gap-1.5 rounded-xl border border-divider-subtle bg-background-default px-3 py-2.5"
        invalid={showError}
      >
        <div className="flex min-h-8 items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <FieldLabel htmlFor={generatedId}>
              <ParameterLabel label={label} required={parameter.required} />
            </FieldLabel>
            {description && (
              <FieldDescription id={descriptionId} className="mt-0.5 py-0 wrap-break-word">
                {description}
              </FieldDescription>
            )}
          </div>
          <Switch
            id={generatedId}
            className="mt-0.5"
            checked={value === true}
            disabled={disabled}
            aria-describedby={describedBy}
            onCheckedChange={(checked) => {
              setTouched(true)
              onChange(checked)
            }}
          />
        </div>
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
      <Field name={parameter.name} className="gap-1.5" invalid={showError}>
        <Select<string | null>
          name={parameter.name}
          disabled={disabled}
          required={parameter.required}
          value={selectedValue}
          onValueChange={(nextValue) => {
            setTouched(true)
            onChange(nextValue ?? undefined)
          }}
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
    <Field name={parameter.name} className="gap-1.5" invalid={showError}>
      <FieldLabel>
        <ParameterLabel label={label} required={parameter.required} />
      </FieldLabel>
      <Input
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
          setTouched(true)
          if (parameter.type === 'number') {
            setNumberDraft(nextValue)
            const number = Number(nextValue)
            onChange(nextValue && Number.isFinite(number) ? number : undefined)
            return
          }
          onChange(nextValue || undefined)
        }}
        onBlur={() => {
          setTouched(true)
          if (parameter.type === 'number' && numberDraft !== undefined) setNumberDraft(undefined)
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
  className,
  columns = 2,
  disabled = false,
  parameters,
  schemas,
  onChange,
}: {
  className?: string
  columns?: 1 | 2
  disabled?: boolean
  parameters: DatasourceParameters
  schemas: DatasourceParameterSchema[]
  onChange: (parameters: DatasourceParameters) => void
}) {
  if (!schemas.length) return null

  return (
    <div
      className={cn(
        'grid grid-cols-1 items-start gap-3',
        columns === 2 && 'sm:grid-cols-2',
        className,
      )}
    >
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

export function WebsiteDatasourceParameterForm({
  additionalPrimaryField,
  disabled = false,
  parameters,
  schemas,
  onChange,
}: {
  additionalPrimaryField?: ReactNode
  disabled?: boolean
  parameters: DatasourceParameters
  schemas: DatasourceParameterSchema[]
  onChange: (parameters: DatasourceParameters) => void
}) {
  const { t } = useTranslation('dataset')
  const [optionsOpen, setOptionsOpen] = useState(false)
  const primarySchemas = schemas.filter((schema) => schema.required)
  const optionSchemas = schemas.filter((schema) => !schema.required)
  const optionDefaults = datasourceParameterDefaults(optionSchemas)
  const usingDefaultOptions = optionSchemas.every(
    (schema) => parameters[schema.name] === optionDefaults[schema.name],
  )
  const resetOptions = () => {
    const next = { ...parameters }
    optionSchemas.forEach((schema) => delete next[schema.name])
    onChange({ ...next, ...optionDefaults })
  }

  if (!schemas.length) return null

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
        {additionalPrimaryField}
        {primarySchemas.map((parameter) => (
          <DatasourceParameterField
            key={parameter.name}
            disabled={disabled}
            parameter={parameter}
            showDescription={false}
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
      {optionSchemas.length > 0 && (
        <Collapsible
          open={optionsOpen}
          className="overflow-hidden rounded-lg border border-divider-subtle bg-background-default"
          onOpenChange={setOptionsOpen}
        >
          <div className="flex h-10 items-center transition-colors hover:bg-components-panel-on-panel-item-bg-hover">
            <CollapsibleTrigger className="h-full min-w-0 flex-1 justify-start rounded-none px-3 hover:not-data-disabled:bg-transparent">
              <span
                aria-hidden
                className="i-ri-arrow-right-s-line size-4 shrink-0 text-text-tertiary transition-transform group-data-panel-open:rotate-90 motion-reduce:transition-none"
              />
              <span className="truncate">{t(($) => $['newKnowledge.crawlOptions'])}</span>
              {!optionsOpen && usingDefaultOptions && (
                <span aria-hidden className="ml-auto shrink-0 system-xs-regular text-text-tertiary">
                  {t(($) => $['newKnowledge.usingDefaults'])}
                </span>
              )}
            </CollapsibleTrigger>
            {optionsOpen && (
              <Button
                className="mr-2"
                disabled={disabled}
                size="small"
                variant="tertiary"
                onClick={resetOptions}
              >
                {t(($) => $['newKnowledge.resetToDefaults'])}
              </Button>
            )}
          </div>
          <CollapsiblePanel>
            <div className="grid grid-cols-1 items-start gap-x-3 gap-y-4 border-t border-divider-subtle bg-background-default p-3 sm:grid-cols-2">
              {optionSchemas.map((parameter) => (
                <DatasourceParameterField
                  key={parameter.name}
                  booleanControl="checkbox"
                  disabled={disabled}
                  parameter={parameter}
                  showDescription={parameter.type === 'boolean'}
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
          </CollapsiblePanel>
        </Collapsible>
      )}
    </div>
  )
}
