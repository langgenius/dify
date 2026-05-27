'use client'

import type {
  CredentialSlot,
} from '@dify/contracts/enterprise/types.gen'
import type { BindingSelections, EnvironmentOption } from './types'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import { SkeletonRectangle, SkeletonRow } from '@/app/components/base/skeleton'
import {
  RuntimeCredentialBindingsPanel,
} from '../components/runtime-credential-bindings'

import { environmentBackend, environmentMode, environmentName } from '../environment'
import { StepShell } from './layout'

const targetEnvironmentSkeletonKeys = ['first-target-environment', 'second-target-environment']
const targetBindingSkeletonKeys = ['first-target-binding', 'second-target-binding']

function EnvironmentOptionRow({ environment, selected, onSelect }: {
  environment: EnvironmentOption
  selected: boolean
  onSelect: () => void
}) {
  const { t } = useTranslation('deployments')
  const mode = environmentMode(environment)

  return (
    <label
      className={cn(
        'flex cursor-pointer items-center gap-3 rounded-xl border p-3',
        selected
          ? 'border-state-accent-solid bg-state-accent-hover shadow-xs'
          : 'border-components-option-card-option-border bg-components-option-card-option-bg hover:border-components-option-card-option-border-hover hover:bg-components-option-card-option-bg-hover hover:shadow-xs',
      )}
    >
      <input
        type="radio"
        name="target-environment"
        checked={selected}
        onChange={onSelect}
        className="size-4 shrink-0 accent-primary-600"
      />
      <span className="flex min-w-0 grow flex-col gap-1">
        <span className={cn('truncate system-sm-semibold', selected ? 'text-text-accent' : 'text-text-primary')}>{environmentName(environment)}</span>
        <span className={cn('flex flex-wrap items-center gap-1.5 system-xs-regular', selected ? 'text-text-secondary' : 'text-text-tertiary')}>
          <span>{t(mode === 'isolated' ? 'mode.isolated' : 'mode.shared')}</span>
          <span>{environmentBackend(environment)}</span>
        </span>
      </span>
    </label>
  )
}

function TargetEnvironmentSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      {targetEnvironmentSkeletonKeys.map(key => (
        <SkeletonRow key={key} className="h-17 rounded-xl border border-divider-subtle px-3 py-3">
          <SkeletonRectangle className="my-0 size-4 animate-pulse rounded-full" />
          <div className="flex min-w-0 grow flex-col gap-1.5">
            <SkeletonRectangle className="my-0 h-3.5 w-1/2 animate-pulse" />
            <SkeletonRectangle className="my-0 h-3 w-2/3 animate-pulse" />
          </div>
        </SkeletonRow>
      ))}
    </div>
  )
}

function TargetBindingSkeleton() {
  return (
    <div className="border-t border-divider-subtle">
      {targetBindingSkeletonKeys.map(key => (
        <SkeletonRow key={key} className="h-15 px-3 py-3">
          <div className="flex min-w-0 grow flex-col gap-1.5">
            <SkeletonRectangle className="my-0 h-3.5 w-1/3 animate-pulse" />
            <SkeletonRectangle className="my-0 h-3 w-1/2 animate-pulse" />
          </div>
          <SkeletonRectangle className="my-0 h-8 w-48 animate-pulse rounded-lg" />
        </SkeletonRow>
      ))}
    </div>
  )
}

function TargetStep({
  environments,
  bindingSlots,
  selectedEnvironmentId,
  bindingSelections,
  isEnvironmentLoading,
  isEnvironmentError,
  isBindingLoading,
  isBindingError,
  onSelectEnvironment,
  onSelectBinding,
}: {
  environments: EnvironmentOption[]
  bindingSlots: CredentialSlot[]
  selectedEnvironmentId: string
  bindingSelections: BindingSelections
  isEnvironmentLoading: boolean
  isEnvironmentError: boolean
  isBindingLoading: boolean
  isBindingError: boolean
  onSelectEnvironment: (environmentId: string) => void
  onSelectBinding: (slot: string, value: string) => void
}) {
  const { t } = useTranslation('deployments')
  const hasEnvironmentOptions = environments.length > 0

  return (
    <StepShell
      title={t('createGuide.target.title')}
      description={t('createGuide.target.description')}
      hideHeader
    >
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <div className="system-xs-medium-uppercase text-text-tertiary">{t('createGuide.target.environment')}</div>
          {hasEnvironmentOptions
            ? (
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {environments.map(environment => (
                    <EnvironmentOptionRow
                      key={environment.id}
                      environment={environment}
                      selected={selectedEnvironmentId === environment.id}
                      onSelect={() => onSelectEnvironment(environment.id)}
                    />
                  ))}
                </div>
              )
            : isEnvironmentLoading
              ? <TargetEnvironmentSkeleton />
              : (
                  <div className="rounded-lg border border-divider-subtle bg-background-default-subtle px-3 py-3 system-sm-regular text-text-quaternary">
                    {isEnvironmentError
                      ? t('createGuide.target.loadEnvironmentsFailed')
                      : t('createGuide.target.noEnvironmentOptions')}
                  </div>
                )}
        </div>
        {isBindingLoading || isBindingError
          ? (
              <div className="overflow-hidden rounded-xl border border-components-option-card-option-border bg-components-option-card-option-bg">
                <div className="flex min-w-0 flex-col gap-0.5 px-3 py-2.5">
                  <div className="system-xs-medium-uppercase text-text-tertiary">{t('createGuide.target.bindings')}</div>
                  <span className="system-xs-regular text-text-quaternary">{t('createGuide.target.bindingHint')}</span>
                </div>
                {isBindingLoading
                  ? <TargetBindingSkeleton />
                  : (
                      <div className="border-t border-divider-subtle px-3 py-3 system-sm-regular text-text-quaternary">
                        {t('createGuide.target.loadBindingsFailed')}
                      </div>
                    )}
              </div>
            )
          : (
              <RuntimeCredentialBindingsPanel
                slots={bindingSlots}
                selections={bindingSelections}
                title={t('createGuide.target.bindings')}
                hint={t('createGuide.target.bindingHint')}
                requiredLabel={t('createGuide.target.required')}
                noBindingRequiredLabel={t('createGuide.target.noBindingRequired')}
                noCredentialCandidatesLabel={t('createGuide.target.noCredentialCandidates')}
                selectCredentialLabel={t('createGuide.target.selectCredential')}
                missingRequiredLabel={t('createGuide.target.missingRequiredBinding')}
                bindingCountLabel={t('createGuide.target.bindingCount', { count: bindingSlots.length })}
                onChange={onSelectBinding}
                className="border-components-option-card-option-border bg-components-option-card-option-bg"
              />
            )}
      </div>
    </StepShell>
  )
}

export function TargetReviewSections({
  bindingSelections,
  bindingSlots,
  environments,
  isBindingError,
  isBindingLoading,
  isEnvironmentError,
  isEnvironmentLoading,
  onSelectBinding,
  onSelectEnvironment,
  selectedEnvironmentId,
}: {
  bindingSelections: BindingSelections
  bindingSlots: CredentialSlot[]
  environments: EnvironmentOption[]
  isBindingError: boolean
  isBindingLoading: boolean
  isEnvironmentError: boolean
  isEnvironmentLoading: boolean
  onSelectBinding: (slot: string, value: string) => void
  onSelectEnvironment: (environmentId: string) => void
  selectedEnvironmentId: string
}) {
  return (
    <TargetStep
      environments={environments}
      bindingSlots={bindingSlots}
      selectedEnvironmentId={selectedEnvironmentId}
      bindingSelections={bindingSelections}
      isEnvironmentLoading={isEnvironmentLoading}
      isEnvironmentError={isEnvironmentError}
      isBindingLoading={isBindingLoading}
      isBindingError={isBindingError}
      onSelectEnvironment={onSelectEnvironment}
      onSelectBinding={onSelectBinding}
    />
  )
}
