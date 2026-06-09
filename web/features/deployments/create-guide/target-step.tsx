'use client'

import type {
  CredentialSlot,
} from '@dify/contracts/enterprise/types.gen'
import type {
  EnvVarBindingSlot,
  EnvVarValues,
  EnvVarValueSelection,
} from '../components/env-var-bindings'
import type { UnsupportedDslNode } from '../error'
import type { BindingSelections, EnvironmentOption } from './types'
import { cn } from '@langgenius/dify-ui/cn'
import { RadioControl, RadioRoot } from '@langgenius/dify-ui/radio'
import { RadioGroup } from '@langgenius/dify-ui/radio-group'
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

function EnvironmentOptionRow({ environment, selected }: {
  environment: EnvironmentOption
  selected: boolean
}) {
  const { t } = useTranslation('deployments')
  const mode = environmentMode(environment)
  const summary = environment.description?.trim() || `${t(mode === 'isolated' ? 'mode.isolated' : 'mode.shared')} · ${environmentBackend(environment).toUpperCase()}`

  return (
    <RadioRoot<string>
      value={environment.id}
      variant="unstyled"
      className={cn(
        'flex cursor-pointer items-center gap-3 rounded-xl border p-3 outline-hidden',
        'border-components-option-card-option-border bg-components-option-card-option-bg hover:border-components-option-card-option-border-hover hover:bg-components-option-card-option-bg-hover hover:shadow-xs',
        'focus-visible:ring-2 focus-visible:ring-state-accent-solid',
        'data-checked:border-state-accent-solid data-checked:bg-state-accent-hover data-checked:shadow-xs',
      )}
    >
      <RadioControl />
      <span className="flex min-w-0 grow flex-col gap-1">
        <span className={cn('truncate system-sm-semibold', selected ? 'text-text-accent' : 'text-text-primary')}>{environmentName(environment)}</span>
        <TitleTooltip content={summary}>
          <span className={cn('line-clamp-1 system-xs-regular', selected ? 'text-text-secondary' : 'text-text-tertiary')}>
            {summary}
          </span>
        </TitleTooltip>
      </span>
    </RadioRoot>
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

export type TargetReviewSectionsProps = {
  environments: EnvironmentOption[]
  bindingSlots: CredentialSlot[]
  envVarSlots: EnvVarBindingSlot[]
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
}

function TargetEnvironmentSection({
  environments,
  isEnvironmentError,
  isEnvironmentLoading,
  selectedEnvironmentId,
  onSelectEnvironment,
}: Pick<TargetReviewSectionsProps, 'environments' | 'isEnvironmentError' | 'isEnvironmentLoading' | 'selectedEnvironmentId' | 'onSelectEnvironment'>) {
  const { t } = useTranslation('deployments')
  const hasEnvironmentOptions = environments.length > 0

  return (
    <div className="flex flex-col gap-3">
      <div className="system-xs-medium-uppercase text-text-tertiary">{t('createGuide.target.environment')}</div>
      {hasEnvironmentOptions
        ? (
            <RadioGroup<string>
              value={selectedEnvironmentId}
              onValueChange={onSelectEnvironment}
              className="grid grid-cols-1 items-stretch gap-3 lg:grid-cols-2"
            >
              {environments.map(environment => (
                <EnvironmentOptionRow
                  key={environment.id}
                  environment={environment}
                  selected={environmentMatchesIdentifier(environment, selectedEnvironmentId)}
                />
              ))}
            </RadioGroup>
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
  )
}

function TargetBindingSection({
  bindingSelections,
  bindingSlots,
  isBindingError,
  isBindingLoading,
  onSelectBinding,
}: Pick<TargetReviewSectionsProps, 'bindingSelections' | 'bindingSlots' | 'isBindingError' | 'isBindingLoading' | 'onSelectBinding'>) {
  const { t } = useTranslation('deployments')

  if (isBindingLoading || isBindingError) {
    return (
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
  }

  return (
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
  )
}

function TargetEnvVarSection({
  envVarSlots,
  envVarValues,
  isBindingError,
  isBindingLoading,
  onSetEnvVar,
}: Pick<TargetReviewSectionsProps, 'envVarSlots' | 'envVarValues' | 'isBindingError' | 'isBindingLoading' | 'onSetEnvVar'>) {
  const { t } = useTranslation('deployments')

  if (isBindingLoading || isBindingError)
    return null

  return (
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
  )
}

export function TargetReviewSections({
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
}: TargetReviewSectionsProps) {
  const { t } = useTranslation('deployments')
  const hasUnsupportedDslNodes = unsupportedDslNodes.length > 0
  const shouldRenderBindingSection = !(isBindingError && hasUnsupportedDslNodes)

  return (
    <StepShell
      title={t('createGuide.target.title')}
      description={t('createGuide.target.description')}
      hideHeader
    >
      <div className="flex flex-col gap-6">
        <TargetEnvironmentSection
          environments={environments}
          isEnvironmentError={isEnvironmentError}
          isEnvironmentLoading={isEnvironmentLoading}
          selectedEnvironmentId={selectedEnvironmentId}
          onSelectEnvironment={onSelectEnvironment}
        />
        {hasUnsupportedDslNodes && (
          <UnsupportedDslNodesAlert nodes={unsupportedDslNodes} />
        )}
        {shouldRenderBindingSection && (
          <TargetBindingSection
            bindingSelections={bindingSelections}
            bindingSlots={bindingSlots}
            isBindingError={isBindingError}
            isBindingLoading={isBindingLoading}
            onSelectBinding={onSelectBinding}
          />
        )}
        <TargetEnvVarSection
          envVarSlots={envVarSlots}
          envVarValues={envVarValues}
          isBindingError={isBindingError}
          isBindingLoading={isBindingLoading}
          onSetEnvVar={onSetEnvVar}
        />
      </div>
    </StepShell>
  )
}
