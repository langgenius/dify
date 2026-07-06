'use client'

import type { Environment } from '@dify/contracts/enterprise/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { RadioControl, RadioItem } from '@langgenius/dify-ui/radio'
import { RadioGroup } from '@langgenius/dify-ui/radio-group'
import { toast } from '@langgenius/dify-ui/toast'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { SkeletonRectangle, SkeletonRow } from '@/app/components/base/skeleton'
import {
  envVarValuesAtom,
  isCreatingReleaseOnlyAtom,
  isSubmittingDeploymentGuideAtom,
  selectedEnvironmentIdAtom,
  stepAtom,
} from '@/features/deployments/create-guide/state/primitives'
import {
  deployableEnvironmentsQueryAtom,
  deploymentOptionsQueryAtom,
  unsupportedDslNodesAtom,
} from '@/features/deployments/create-guide/state/queries'
import {
  createDeploymentGuideSubmissionAtom,
  CreateDeploymentGuideSubmissionBlockedError,
} from '@/features/deployments/create-guide/state/submission'
import {
  canDeployAtom,
  canSkipDeploymentAtom,
  deployableEnvironmentsAtom,
  deploymentTargetBindingSelectionsAtom,
  deploymentTargetBindingSlotsAtom,
  deploymentTargetEnvVarSlotsAtom,
  effectiveSelectedEnvironmentIdAtom,
  selectBindingAtom,
  setEnvVarAtom,
} from '@/features/deployments/create-guide/state/target'
import {
  EnvVarBindingsPanel,
} from '@/features/deployments/shared/components/env-var-bindings'
import {
  RuntimeCredentialBindingsPanel,
} from '@/features/deployments/shared/components/runtime-credential-bindings'
import { TitleTooltip } from '@/features/deployments/shared/components/title-tooltip'
import { UnsupportedDslNodesAlert } from '@/features/deployments/shared/components/unsupported-dsl-nodes-alert'
import { deploymentErrorMessage } from '@/features/deployments/shared/domain/error'
import { useRouter } from '@/next/navigation'
import { StepShell } from './layout'

const targetEnvironmentSkeletonKeys = ['first-target-environment', 'second-target-environment']
const targetBindingSkeletonKeys = ['first-target-binding', 'second-target-binding']

export function TargetStepContent() {
  const { t } = useTranslation('deployments')
  const unsupportedDslNodes = useAtomValue(unsupportedDslNodesAtom)

  return (
    <StepShell
      title={t('createGuide.target.title')}
      description={t('createGuide.target.description')}
      hideHeader
    >
      <div className="flex flex-col gap-6">
        <TargetEnvironmentSection />
        <UnsupportedDslNodesAlert nodes={unsupportedDslNodes} />
        <TargetBindingSection />
        <TargetEnvVarSection />
      </div>
    </StepShell>
  )
}

function TargetEnvironmentSection() {
  const { t } = useTranslation('deployments')
  const environmentsQuery = useAtomValue(deployableEnvironmentsQueryAtom)
  const environments = useAtomValue(deployableEnvironmentsAtom)
  const effectiveSelectedEnvironmentId = useAtomValue(effectiveSelectedEnvironmentIdAtom)
  const isEnvironmentError = environmentsQuery.isError
  const isEnvironmentLoading = environmentsQuery.isLoading || (environmentsQuery.isFetching && !environmentsQuery.data)
  const selectEnvironment = useSetAtom(selectedEnvironmentIdAtom)
  const hasEnvironmentOptions = environments.length > 0

  return (
    <div className="flex flex-col gap-3">
      <div className="system-xs-medium-uppercase text-text-tertiary">{t('createGuide.target.environment')}</div>
      {hasEnvironmentOptions
        ? (
            <RadioGroup<string>
              value={effectiveSelectedEnvironmentId}
              onValueChange={selectEnvironment}
              className="grid grid-cols-1 items-stretch gap-3 lg:grid-cols-2"
            >
              {environments.map(environment => (
                <EnvironmentOptionRow
                  key={environment.id}
                  environment={environment}
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

function EnvironmentOptionRow({ environment }: {
  environment: Environment
}) {
  const { t } = useTranslation('deployments')
  const summary = environment.description.trim() || `${t(`mode.${environment.mode}`)} · ${t(`backend.${environment.backend}`)}`

  return (
    <RadioItem<string>
      value={environment.id}
      className={cn(
        'group flex cursor-pointer items-center gap-3 rounded-xl border p-3 outline-hidden',
        'border-components-option-card-option-border bg-components-option-card-option-bg hover:border-components-option-card-option-border-hover hover:bg-components-option-card-option-bg-hover hover:shadow-xs',
        'focus-visible:ring-2 focus-visible:ring-state-accent-solid',
        'data-checked:border-state-accent-solid data-checked:bg-state-accent-hover data-checked:shadow-xs',
      )}
    >
      <RadioControl />
      <span className="flex min-w-0 grow flex-col gap-1">
        <span className="truncate system-sm-semibold text-text-primary group-data-checked:text-text-accent">{environment.displayName}</span>
        <TitleTooltip content={summary}>
          <span className="line-clamp-1 system-xs-regular text-text-tertiary group-data-checked:text-text-secondary">
            {summary}
          </span>
        </TitleTooltip>
      </span>
    </RadioItem>
  )
}

function TargetBindingSection() {
  const { t } = useTranslation('deployments')
  const deploymentOptionsQuery = useAtomValue(deploymentOptionsQueryAtom)
  const bindingSlots = useAtomValue(deploymentTargetBindingSlotsAtom)
  const bindingSelections = useAtomValue(deploymentTargetBindingSelectionsAtom)
  const isBindingError = deploymentOptionsQuery.isError
  const isBindingLoading = deploymentOptionsQuery.isLoading || (deploymentOptionsQuery.isFetching && !deploymentOptionsQuery.data)
  const selectBinding = useSetAtom(selectBindingAtom)
  const unsupportedDslNodes = useAtomValue(unsupportedDslNodesAtom)
  const shouldRender = !(isBindingError && unsupportedDslNodes.length > 0)

  if (!shouldRender)
    return null

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
      onChange={selectBinding}
      listScrollable={false}
      className="border-components-option-card-option-border bg-components-option-card-option-bg"
    />
  )
}

function TargetEnvVarSection() {
  const { t } = useTranslation('deployments')
  const setEnvVar = useSetAtom(setEnvVarAtom)
  const envVarValues = useAtomValue(envVarValuesAtom)
  const deploymentOptionsQuery = useAtomValue(deploymentOptionsQueryAtom)
  const envVarSlots = useAtomValue(deploymentTargetEnvVarSlotsAtom)
  const isBindingError = deploymentOptionsQuery.isError
  const isBindingLoading = deploymentOptionsQuery.isLoading || (deploymentOptionsQuery.isFetching && !deploymentOptionsQuery.data)

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
      onChange={setEnvVar}
      listScrollable={false}
      className="border-components-option-card-option-border bg-components-option-card-option-bg"
    />
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

export function TargetBackButton() {
  const { t } = useTranslation('deployments')
  const setStep = useSetAtom(stepAtom)
  const isSubmitting = useAtomValue(isSubmittingDeploymentGuideAtom)

  return (
    <Button type="button" variant="secondary" onClick={() => setStep('release')} disabled={isSubmitting}>
      {t('createGuide.actions.back')}
    </Button>
  )
}

export function TargetSkipDeploymentButton() {
  const { t } = useTranslation('deployments')
  const router = useRouter()
  const canSkipDeployment = useAtomValue(canSkipDeploymentAtom)
  const submitCreateDeploymentGuide = useSetAtom(createDeploymentGuideSubmissionAtom)
  const isSubmitting = useAtomValue(isSubmittingDeploymentGuideAtom)
  const isSkippingDeployment = useAtomValue(isCreatingReleaseOnlyAtom)
  const label = isSkippingDeployment
    ? t('createGuide.actions.creating')
    : t('createGuide.actions.skipDeploy')

  async function handleSkipDeployment() {
    if (!canSkipDeployment)
      return

    try {
      const appInstanceId = await submitCreateDeploymentGuide({ deployToEnvironment: false })
      if (appInstanceId)
        router.push(`/deployments/${appInstanceId}/overview`)
    }
    catch (error) {
      await showSubmissionError({
        error,
        fallbackMessage: t('createGuide.errors.createReleaseFailed'),
        unsupportedDslModeMessage: t('createGuide.dsl.unsupportedMode'),
      })
    }
  }

  return (
    <Button type="button" variant="secondary" disabled={!canSkipDeployment || isSubmitting} onClick={handleSkipDeployment}>
      {label}
    </Button>
  )
}

export function TargetDeployButton() {
  const { t } = useTranslation('deployments')
  const router = useRouter()
  const canDeploy = useAtomValue(canDeployAtom)
  const submitCreateDeploymentGuide = useSetAtom(createDeploymentGuideSubmissionAtom)
  const isSubmitting = useAtomValue(isSubmittingDeploymentGuideAtom)
  const isSkippingDeployment = useAtomValue(isCreatingReleaseOnlyAtom)
  const label = isSubmitting && !isSkippingDeployment
    ? t('createGuide.actions.deploying')
    : t('createGuide.actions.createAndDeploy')

  async function handleDeploy() {
    if (!canDeploy)
      return

    try {
      const appInstanceId = await submitCreateDeploymentGuide({ deployToEnvironment: true })
      if (appInstanceId)
        router.push(`/deployments/${appInstanceId}/overview`)
    }
    catch (error) {
      await showSubmissionError({
        error,
        fallbackMessage: t('createGuide.errors.deployFailed'),
        unsupportedDslModeMessage: t('createGuide.dsl.unsupportedMode'),
      })
    }
  }

  return (
    <Button type="button" variant="primary" disabled={!canDeploy || isSubmitting} onClick={handleDeploy}>
      {label}
    </Button>
  )
}

async function showSubmissionError({
  error,
  fallbackMessage,
  unsupportedDslModeMessage,
}: {
  error: unknown
  fallbackMessage: string
  unsupportedDslModeMessage: string
}) {
  if (error instanceof CreateDeploymentGuideSubmissionBlockedError) {
    toast.error(error.reason === 'unsupportedDslMode' ? unsupportedDslModeMessage : fallbackMessage)
    return
  }

  toast.error(await deploymentErrorMessage(error) || fallbackMessage)
}
