'use client'

import type { ReactNode } from 'react'
import type { NewKnowledgeSourceDraft, NewKnowledgeSourceType } from './routes'
import type { InstalledSourceProviderOption, SourceProviderOption } from './source-provider-options'
import { Button, buttonVariants } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { Fieldset, FieldsetLegend } from '@langgenius/dify-ui/fieldset'
import { Input } from '@langgenius/dify-ui/input'
import { RadioGroup, RadioItem } from '@langgenius/dify-ui/radio-group'
import { useTranslation } from 'react-i18next'
import { buildIntegrationPath } from '@/app/components/integrations/routes'
import Link from '@/next/link'
import { NEW_KNOWLEDGE_SOURCE_NAME_MAX_LENGTH } from './routes'
import { SyncPolicyField } from './sync-policy-field'

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

type SourceProviderIconValue =
  | InstalledSourceProviderOption['datasource']['identity']['icon']
  | InstalledSourceProviderOption['plugin']['declaration']['identity']['icon']

export function SourceProviderIcon({
  className,
  fallbackIcon,
  icon,
}: {
  className?: string
  fallbackIcon: string
  icon?: SourceProviderIconValue
}) {
  if (typeof icon === 'string' && icon)
    return (
      <img
        aria-hidden
        alt=""
        className={cn('size-4 shrink-0 object-contain', className)}
        src={icon}
      />
    )

  if (icon && typeof icon !== 'string')
    return (
      <span
        aria-hidden
        className={cn(
          'flex size-4 shrink-0 items-center justify-center overflow-hidden rounded text-2xs',
          className,
        )}
        style={{ backgroundColor: icon.background }}
      >
        {icon.content}
      </span>
    )

  return <span aria-hidden className={cn(fallbackIcon, 'size-4 shrink-0', className)} />
}

export function SourceProviderSelector({
  appearance = 'page',
  disabled = false,
  layout = 'grid-three',
  options,
  providerKey,
  onChange,
}: {
  appearance?: 'embedded' | 'page'
  disabled?: boolean
  layout?: 'grid-four' | 'grid-three'
  options: SourceProviderOption[]
  providerKey: string
  onChange: (providerKey: string) => void
}) {
  const { t } = useTranslation('dataset')

  return (
    <Fieldset disabled={disabled}>
      <div
        className={cn(
          'flex items-center justify-between gap-3',
          appearance === 'embedded' ? 'mb-2' : 'mb-1.5',
        )}
      >
        <FieldsetLegend className="py-0 system-xs-medium">
          {t(($) => $['newKnowledge.providerLabel'])}
        </FieldsetLegend>
        <Link
          aria-disabled={disabled || undefined}
          className={cn(
            buttonVariants({ variant: 'ghost-accent', size: 'small' }),
            'gap-1 pr-1.5 pl-2.25 text-[13px] leading-4 font-normal active:bg-state-accent-active',
          )}
          data-disabled={disabled ? '' : undefined}
          href={buildIntegrationPath('data-source')}
          rel="noopener noreferrer"
          tabIndex={disabled ? -1 : undefined}
          target="_blank"
          onClick={disabled ? (event) => event.preventDefault() : undefined}
        >
          {t(($) => $['newKnowledge.moreProviders'])}
          <span aria-hidden className="i-ri-arrow-right-up-line size-3.5" />
        </Link>
      </div>
      <SourceProviderRadioGroup
        value={providerKey}
        disabled={disabled}
        layout={layout}
        options={options.map((option) => ({
          icon: (
            <SourceProviderIcon
              fallbackIcon={option.fallbackIcon}
              icon={
                option.installed
                  ? (option.datasource.identity.icon ?? option.plugin.declaration.identity.icon)
                  : undefined
              }
            />
          ),
          label: option.label,
          value: option.key,
        }))}
        size="medium"
        surface="default"
        onChange={onChange}
      />
    </Fieldset>
  )
}

export function SourceNameField({
  className,
  disabled = false,
  draft,
  labelClassName,
  name = 'sourceName',
  preventSubmitOnEnter = false,
  onDraftChange,
}: {
  className?: string
  disabled?: boolean
  draft: NewKnowledgeSourceDraft
  labelClassName?: string
  name?: string
  preventSubmitOnEnter?: boolean
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
      <Input
        type="text"
        autoComplete="off"
        disabled={disabled}
        maxLength={NEW_KNOWLEDGE_SOURCE_NAME_MAX_LENGTH}
        value={draft.sourceName}
        placeholder={t(($) => $['newKnowledge.sourceNamePlaceholder'])}
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
  return (
    <SyncPolicyField
      availableModes={[
        ...(availablePolicies.includes('provider') ? (['provider'] as const) : []),
        ...(availablePolicies.includes('manual') ? (['manual'] as const) : []),
        ...(availablePolicies.includes('daily') ? (['interval', 'custom'] as const) : []),
      ]}
      className={className}
      disabled={disabled}
      size={size}
      triggerClassName={triggerClassName}
      value={{
        customIntervalSeconds: draft.customIntervalSeconds,
        mode:
          draft.syncPolicy === 'daily'
            ? 'interval'
            : draft.syncPolicy === 'custom'
              ? 'custom'
              : draft.syncPolicy,
      }}
      onChange={(value) =>
        onDraftChange({
          ...draft,
          customIntervalSeconds: value.customIntervalSeconds,
          syncPolicy: value.mode === 'interval' ? 'daily' : value.mode,
        })
      }
    />
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

export function SourceProviderCredentialRequiredCard({
  disabled = false,
  icon,
  provider,
  onConnect,
}: {
  disabled?: boolean
  icon: ReactNode
  provider: string
  onConnect: () => void
}) {
  const { t } = useTranslation('dataset')

  return (
    <SourceConnectionRequiredCard
      actionLabel={t(($) => $['newKnowledge.connectProvider'], { provider })}
      description={t(($) => $['newKnowledge.providerCredentialRequiredDescription'], {
        provider,
      })}
      disabled={disabled}
      icon={icon}
      title={t(($) => $['newKnowledge.providerNotConfigured'], { provider })}
      onConnect={onConnect}
    />
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
