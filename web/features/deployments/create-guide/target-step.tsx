'use client'

import type {
  CredentialSlot,
} from '@dify/contracts/enterprise/types.gen'
import type {
  DeploymentEnvVarSlot,
  EnvVarValues,
  EnvVarValueSelection,
} from '../components/env-var-bindings-utils'
import type { UnsupportedDslNode } from '../error'
import type { BindingSelections, EnvironmentOption } from './types'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import { SkeletonRectangle, SkeletonRow } from '@/app/components/base/skeleton'
import {
  EnvVarBindingsPanel,
} from '../components/env-var-bindings'
import {
  RuntimeCredentialBindingsPanel,
} from '../components/runtime-credential-bindings'
import { TitleTooltip } from '../components/title-tooltip'
import { UnsupportedDslNodesAlert } from '../components/unsupported-dsl-nodes-alert'

import {
  environmentBackend,
  environmentMatchesIdentifier,
  environmentMode,
  environmentName,
} from '../environment'
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
  const summary = environment.description?.trim() || `${t(mode === 'isolated' ? 'mode.isolated' : 'mode.shared')} · ${environmentBackend(environment).toUpperCase()}`

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
        <TitleTooltip content={summary}>
          <span className={cn('line-clamp-1 system-xs-regular', selected ? 'text-text-secondary' : 'text-text-tertiary')}>
            {summary}
          </span>
        </TitleTooltip>
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
  envVarSlots,
  selectedEnvironmentId,
  bindingSelections,
  envVarValues,
  isEnvironmentLoading,
  isEnvironmentError,
  isBindingLoading,
  isBindingError,
  unsupportedDslNodes,
  onSelectEnvironment,
  onSelectBinding,
  onSetEnvVar,
}: {
  environments: EnvironmentOption[]
  bindingSlots: CredentialSlot[]
  envVarSlots: DeploymentEnvVarSlot[]
  selectedEnvironmentId: string
  bindingSelections: BindingSelections
  envVarValues: EnvVarValues
  isEnvironmentLoading: boolean
  isEnvironmentError: boolean
  isBindingLoading: boolean
  isBindingError: boolean
  unsupportedDslNodes: UnsupportedDslNode[]
  onSelectEnvironment: (environmentId: string) => void
  onSelectBinding: (slot: string, value: string) => void
  onSetEnvVar: (key: string, value: EnvVarValueSelection) => void
}) {
  const { t } = useTranslation('deployments')
  const hasEnvironmentOptions = environments.length > 0
  const hasUnsupportedDslNodes = unsupportedDslNodes.length > 0
  const shouldRenderBindingSection = !(isBindingError && hasUnsupportedDslNodes)

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
                      selected={environmentMatchesIdentifier(environment, selectedEnvironmentId)}
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
        {hasUnsupportedDslNodes && (
          <UnsupportedDslNodesAlert nodes={unsupportedDslNodes} />
        )}
        {shouldRenderBindingSection && (isBindingLoading || isBindingError)
          ? (
              <div className="overflow-hidden rounded-xl border border-components-option-card-option-border bg-components-option-card-option-bg">
                <div className="flex min-w-0 flex-col gap-0.5 px-3 py-2.5">
                  <div className="system-xs-medium-uppercase text-text-tertiary">{t('createGuide.target.bindings')}</div>
                  <span className="system-xs-regular text-text-tertiary">{t('createGuide.target.bindingHint')}</span>
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
          : shouldRenderBindingSection && (
            <RuntimeCredentialBindingsPanel
              slots={bindingSlots}
              selections={bindingSelections}
              title={t('createGuide.target.bindings')}
              hint={t('createGuide.target.bindingHint')}
              noBindingRequiredLabel={t('createGuide.target.noBindingRequired')}
              noCredentialCandidatesLabel={t('createGuide.target.noCredentialCandidates')}
              selectCredentialLabel={t('createGuide.target.selectCredential')}
              missingRequiredLabel={t('createGuide.target.missingRequiredBinding')}
              bindingCountLabel={t('createGuide.target.bindingCount', { count: bindingSlots.length })}
              onChange={onSelectBinding}
              listScrollable={false}
              className="border-components-option-card-option-border bg-components-option-card-option-bg"
            />
          )}
        {!isBindingLoading && !isBindingError && (
          <EnvVarBindingsPanel
            slots={envVarSlots}
            values={envVarValues}
            title={t('createGuide.target.envVars')}
            hint={t('createGuide.target.envVarHint')}
            envVarPlaceholder={t('createGuide.target.envVarPlaceholder')}
            literalSourceLabel={t('createGuide.target.envVarSource.literal')}
            defaultSourceLabel={t('createGuide.target.envVarSource.default')}
            lastDeploymentSourceLabel={t('createGuide.target.envVarSource.lastDeployment')}
            valueTypeLabels={{
              string: t('createGuide.target.envVarType.string'),
              number: t('createGuide.target.envVarType.number'),
              secret: t('createGuide.target.envVarType.secret'),
            }}
            sourceAriaLabel={key => t('createGuide.target.envVarSource.ariaLabel', { key })}
            envVarCountLabel={t('createGuide.target.envVarCount', { count: envVarSlots.length })}
            onChange={onSetEnvVar}
            listScrollable={false}
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
  envVarSlots,
  envVarValues,
  environments,
  isBindingError,
  isBindingLoading,
  isEnvironmentError,
  isEnvironmentLoading,
  onSelectBinding,
  onSelectEnvironment,
  onSetEnvVar,
  selectedEnvironmentId,
  unsupportedDslNodes,
}: {
  bindingSelections: BindingSelections
  bindingSlots: CredentialSlot[]
  envVarSlots: DeploymentEnvVarSlot[]
  envVarValues: EnvVarValues
  environments: EnvironmentOption[]
  isBindingError: boolean
  isBindingLoading: boolean
  isEnvironmentError: boolean
  isEnvironmentLoading: boolean
  onSelectBinding: (slot: string, value: string) => void
  onSelectEnvironment: (environmentId: string) => void
  onSetEnvVar: (key: string, value: EnvVarValueSelection) => void
  selectedEnvironmentId: string
  unsupportedDslNodes: UnsupportedDslNode[]
}) {
  return (
    <TargetStep
      environments={environments}
      bindingSlots={bindingSlots}
      envVarSlots={envVarSlots}
      selectedEnvironmentId={selectedEnvironmentId}
      bindingSelections={bindingSelections}
      envVarValues={envVarValues}
      isEnvironmentLoading={isEnvironmentLoading}
      isEnvironmentError={isEnvironmentError}
      isBindingLoading={isBindingLoading}
      isBindingError={isBindingError}
      unsupportedDslNodes={unsupportedDslNodes}
      onSelectEnvironment={onSelectEnvironment}
      onSelectBinding={onSelectBinding}
      onSetEnvVar={onSetEnvVar}
    />
  )
}
