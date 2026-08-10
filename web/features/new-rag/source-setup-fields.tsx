'use client'

import type { ReactNode } from 'react'
import type { NewKnowledgeSourceDraft, NewKnowledgeSourceType } from './routes'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Field, FieldControl, FieldLabel } from '@langgenius/dify-ui/field'
import { Fieldset, FieldsetLegend } from '@langgenius/dify-ui/fieldset'
import { RadioGroup, RadioItem } from '@langgenius/dify-ui/radio'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectLabel,
  SelectTrigger,
} from '@langgenius/dify-ui/select'
import { useTranslation } from 'react-i18next'
import { NEW_KNOWLEDGE_SOURCE_NAME_MAX_LENGTH } from './routes'

const sourceTypeOptions = [
  { icon: 'i-ri-global-line', iconSize: 'size-4', value: 'websiteCrawl' },
  { icon: 'i-ri-file-text-line', iconSize: 'size-3.5', value: 'onlineDocuments' },
  { icon: 'i-ri-hard-drive-3-line', iconSize: 'size-3.5', value: 'onlineDrive' },
] as const

const defaultSyncPolicies = ['provider', 'daily', 'manual'] as const

export function SourceTypeSelector({
  appearance = 'page',
  disabled = false,
  disabledValues = [],
  value,
  onChange,
}: {
  appearance?: 'embedded' | 'page'
  disabled?: boolean
  disabledValues?: readonly NewKnowledgeSourceType[]
  value: NewKnowledgeSourceType
  onChange: (value: NewKnowledgeSourceType) => void
}) {
  const { t } = useTranslation('dataset')

  return (
    <Fieldset disabled={disabled}>
      <FieldsetLegend
        className={cn(
          'py-0 system-xs-medium',
          appearance === 'embedded' ? 'mb-1.25' : 'mb-1.5 leading-3.75',
        )}
      >
        {t(($) => $['newKnowledge.sourceTypeLabel'])}
      </FieldsetLegend>
      <RadioGroup<NewKnowledgeSourceType>
        value={value}
        disabled={disabled}
        className="grid grid-cols-1 gap-0.5 rounded-lg bg-background-section p-0.5 sm:grid-cols-3"
        onValueChange={onChange}
      >
        {sourceTypeOptions.map((option) => (
          <RadioItem<NewKnowledgeSourceType>
            key={option.value}
            value={option.value}
            disabled={disabled || disabledValues.includes(option.value)}
            className={cn(
              'relative flex items-center justify-center gap-1.5 rounded-md system-xs-medium text-text-tertiary outline-hidden',
              appearance === 'embedded' ? 'min-h-7 px-2' : 'h-7',
              'hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid',
              appearance === 'embedded'
                ? 'data-checked:bg-components-option-card-option-selected-bg data-checked:text-text-primary data-checked:shadow-xs data-disabled:cursor-not-allowed data-disabled:opacity-60'
                : 'data-checked:bg-background-default data-checked:text-text-primary data-checked:shadow-xs',
            )}
          >
            <span
              aria-hidden
              className={`${option.icon} ${appearance === 'embedded' ? 'size-4' : option.iconSize}`}
            />
            {t(($) => $[`newKnowledge.${option.value}`])}
          </RadioItem>
        ))}
      </RadioGroup>
    </Fieldset>
  )
}

export function SourceProviderRadioGroup<T extends string>({
  disabled = false,
  layout,
  options,
  size = 'medium',
  surface = 'transparent',
  value,
  onChange,
}: {
  disabled?: boolean
  layout: 'grid-four' | 'grid-three' | 'wrap'
  options: Array<{ disabled?: boolean; icon: ReactNode; label?: ReactNode; value: T }>
  size?: 'medium' | 'small'
  surface?: 'default' | 'transparent'
  value: T
  onChange: (value: T) => void
}) {
  return (
    <RadioGroup<T>
      value={value}
      disabled={disabled}
      className={cn(
        layout === 'wrap' ? 'flex flex-wrap gap-2' : 'grid grid-cols-2 gap-2',
        layout === 'grid-three' && 'sm:grid-cols-3',
        layout === 'grid-four' && 'sm:grid-cols-4',
      )}
      onValueChange={onChange}
    >
      {options.map((option) => (
        <RadioItem<T>
          key={option.value}
          value={option.value}
          disabled={disabled || option.disabled}
          className={cn(
            'relative flex items-center justify-center gap-1.5 rounded-lg border border-divider-subtle system-xs-medium text-text-secondary outline-hidden',
            size === 'medium' ? 'h-8.5 px-2.5' : 'h-7.5 px-3',
            surface === 'default' && 'bg-background-default',
            'hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid',
            'data-checked:border-[1.5px] data-checked:border-components-option-card-option-selected-border data-checked:bg-components-option-card-option-selected-bg data-checked:text-text-primary',
            'data-disabled:cursor-not-allowed data-disabled:opacity-60',
          )}
        >
          {option.icon}
          <span className="truncate">{option.label ?? option.value}</span>
        </RadioItem>
      ))}
    </RadioGroup>
  )
}

export function SourceNameField({
  className,
  disabled = false,
  draft,
  labelClassName,
  name = 'sourceName',
  preventSubmitOnEnter = false,
  size,
  onDraftChange,
}: {
  className?: string
  disabled?: boolean
  draft: NewKnowledgeSourceDraft
  labelClassName?: string
  name?: string
  preventSubmitOnEnter?: boolean
  size?: 'large' | 'medium'
  onDraftChange: (draft: NewKnowledgeSourceDraft) => void
}) {
  const { t } = useTranslation('dataset')

  return (
    <Field name={name} className={cn('gap-1.5', className)}>
      <FieldLabel className={labelClassName}>
        {t(($) => $['newKnowledge.sourceName'])}
        <span aria-hidden className="ml-0.5 text-text-destructive">
          *
        </span>
      </FieldLabel>
      <FieldControl
        type="text"
        autoComplete="off"
        disabled={disabled}
        maxLength={NEW_KNOWLEDGE_SOURCE_NAME_MAX_LENGTH}
        value={draft.sourceName}
        placeholder={t(($) => $['newKnowledge.sourceNamePlaceholder'])}
        size={size}
        onValueChange={(value) => onDraftChange({ ...draft, sourceName: value })}
        onKeyDown={(event) => {
          if (preventSubmitOnEnter && event.key === 'Enter') event.preventDefault()
        }}
      />
    </Field>
  )
}

export function SourceSyncPolicyField({
  availablePolicies = defaultSyncPolicies,
  className,
  disabled = false,
  draft,
  size,
  triggerClassName,
  onDraftChange,
}: {
  availablePolicies?: readonly NewKnowledgeSourceDraft['syncPolicy'][]
  className?: string
  disabled?: boolean
  draft: NewKnowledgeSourceDraft
  size?: 'large' | 'medium'
  triggerClassName?: string
  onDraftChange: (draft: NewKnowledgeSourceDraft) => void
}) {
  const { t } = useTranslation('dataset')

  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <Select<NewKnowledgeSourceDraft['syncPolicy']>
        name="syncPolicy"
        disabled={disabled}
        value={draft.syncPolicy}
        onValueChange={(value) => {
          if (value) onDraftChange({ ...draft, syncPolicy: value })
        }}
      >
        <SelectLabel>{t(($) => $['newKnowledge.syncPolicy'])}</SelectLabel>
        <SelectTrigger className={triggerClassName} size={size}>
          {t(($) =>
            draft.syncPolicy === 'provider'
              ? $['newKnowledge.syncPolicyProvider']
              : draft.syncPolicy === 'daily'
                ? $['newKnowledge.syncPolicyDaily']
                : $['newKnowledge.syncPolicyManual'],
          )}
        </SelectTrigger>
        <SelectContent>
          {availablePolicies.map((policy) => (
            <SelectItem key={policy} value={policy}>
              <SelectItemText>
                {t(($) =>
                  policy === 'provider'
                    ? $['newKnowledge.syncPolicyProvider']
                    : policy === 'daily'
                      ? $['newKnowledge.syncPolicyDaily']
                      : $['newKnowledge.syncPolicyManual'],
                )}
              </SelectItemText>
              <SelectItemIndicator />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export function SourceConnectionRequiredCard({
  actionLabel,
  description,
  disabled = false,
  icon,
  title,
  onConnect,
}: {
  actionLabel: string
  description: string
  disabled?: boolean
  icon: ReactNode
  title: string
  onConnect: () => void
}) {
  return (
    <section className="flex h-44 flex-col items-start gap-2.5 rounded-xl bg-background-section p-4">
      <span className="flex size-9 items-center justify-center rounded-lg border-[0.5px] border-divider-subtle bg-background-default">
        {icon}
      </span>
      <h3 className="system-sm-semibold text-text-primary">{title}</h3>
      <p className="max-w-xl system-xs-regular leading-3.75 text-text-tertiary">{description}</p>
      <Button
        type="button"
        variant="primary"
        disabled={disabled}
        className="mt-auto"
        onClick={onConnect}
      >
        {actionLabel}
      </Button>
    </section>
  )
}

export function SourceProviderNotInstalledCard({
  icon,
  provider,
  onInstall,
}: {
  icon: ReactNode
  provider: string
  onInstall: () => void
}) {
  const { t: tPlugin } = useTranslation('plugin')
  const { t: tWorkflow } = useTranslation('workflow')

  return (
    <section className="flex min-h-44 flex-col items-start gap-2.5 rounded-xl bg-background-section p-4">
      <span className="flex size-9 items-center justify-center rounded-lg border-[0.5px] border-divider-subtle bg-background-default">
        {icon}
      </span>
      <h3 className="system-sm-semibold text-text-primary">{provider}</h3>
      <p className="system-xs-regular text-text-tertiary">
        {tWorkflow(($) => $['nodes.common.pluginNotInstalled'])}
      </p>
      <Button type="button" variant="primary" className="mt-auto" onClick={onInstall}>
        {tPlugin(($) => $.installPlugin)}
      </Button>
    </section>
  )
}
