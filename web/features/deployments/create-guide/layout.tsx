'use client'

import type { ReactNode } from 'react'
import type { GuideStep } from './types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { ScrollArea } from '@langgenius/dify-ui/scroll-area'
import { useTranslation } from 'react-i18next'

const GUIDE_PROGRESS_STEPS: GuideStep[] = ['source', 'release', 'target']

function GuideStepIntro({ activeStep }: {
  activeStep: GuideStep
}) {
  const { t } = useTranslation('deployments')

  let title: string
  let description: string

  if (activeStep === 'source') {
    title = t('createGuide.source.title')
    description = t('createGuide.method.description')
  }
  else if (activeStep === 'release') {
    title = t('createGuide.release.title')
    description = t('createGuide.release.description')
  }
  else if (activeStep === 'target') {
    title = t('createGuide.target.title')
    description = t('createGuide.target.description')
  }
  else {
    return null
  }

  return (
    <div className="pb-4">
      <h2 className="system-md-semibold text-text-primary">{title}</h2>
      <p className="mt-1 max-w-150 system-sm-regular text-text-tertiary">{description}</p>
    </div>
  )
}

function GuideProgress({ activeStep }: {
  activeStep: GuideStep
}) {
  const { t } = useTranslation('deployments')
  const activeIndex = GUIDE_PROGRESS_STEPS.indexOf(activeStep)

  return (
    <ol className="grid grid-cols-3 gap-1.5">
      {GUIDE_PROGRESS_STEPS.map((step, index) => {
        const isActive = step === activeStep
        const isComplete = index < activeIndex
        const label = t(`createGuide.steps.${step}`)

        return (
          <li
            key={step}
            aria-current={isActive ? 'step' : undefined}
            title={label}
            className={cn(
              'flex min-w-0 items-start gap-1.5 px-1 py-1.5 system-xs-medium sm:items-center sm:gap-2 sm:px-2',
              isActive
                ? 'text-text-primary'
                : isComplete
                  ? 'text-text-secondary'
                  : 'text-text-quaternary',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'mt-1 size-2 shrink-0 rounded-full border-[1.5px] sm:mt-0',
                isActive
                  ? 'border-text-primary bg-text-primary'
                  : isComplete
                    ? 'border-text-secondary bg-text-secondary'
                    : 'border-text-quaternary bg-transparent',
              )}
            />
            <span className="line-clamp-2 min-w-0 leading-4">{label}</span>
          </li>
        )
      })}
    </ol>
  )
}

function GuideProgressSummary({ activeStep }: {
  activeStep: GuideStep
}) {
  const { t } = useTranslation('deployments')
  const activeIndex = GUIDE_PROGRESS_STEPS.indexOf(activeStep)
  const activeStepNumber = activeIndex + 1

  let activeStepLabel: string
  if (activeStep === 'source')
    activeStepLabel = t('createGuide.steps.source')
  else if (activeStep === 'release')
    activeStepLabel = t('createGuide.steps.release')
  else if (activeStep === 'target')
    activeStepLabel = t('createGuide.steps.target')
  else
    return null

  if (activeIndex < 0)
    return null

  return (
    <div className="flex w-full min-w-0 flex-col gap-2">
      <div className="flex min-w-0 items-baseline justify-between gap-3">
        <span className="truncate system-sm-medium text-text-secondary">{activeStepLabel}</span>
        <span className="shrink-0 system-xs-regular text-text-quaternary">
          {activeStepNumber}
          /
          {GUIDE_PROGRESS_STEPS.length}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-1" aria-hidden="true">
        {GUIDE_PROGRESS_STEPS.map((step, index) => (
          <span
            key={step}
            className={cn(
              'h-1 rounded-full',
              index <= activeIndex ? 'bg-text-primary' : 'bg-divider-subtle',
            )}
          />
        ))}
      </div>
    </div>
  )
}

export function StepShell({ title, description, descriptionClassName, hideHeader, children }: {
  title: string
  description: string
  descriptionClassName?: string
  hideHeader?: boolean
  children: ReactNode
}) {
  return (
    <section aria-label={hideHeader ? title : undefined} className="flex min-w-0 flex-col gap-4">
      {!hideHeader && (
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="system-md-semibold text-text-primary">{title}</h2>
          <p className={cn('system-sm-regular text-text-tertiary', descriptionClassName)}>{description}</p>
        </div>
      )}
      {children}
    </section>
  )
}

export function GuideCard({ children, actions }: {
  children: ReactNode
  actions: ReactNode
}) {
  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
      <ScrollArea
        className="min-h-0 flex-1"
        slotClassNames={{
          viewport: 'overscroll-contain',
          content: 'min-h-full pt-0.5 pb-6',
          scrollbar: 'data-[orientation=vertical]:-me-5 data-[orientation=vertical]:my-1',
        }}
      >
        {children}
      </ScrollArea>
      {actions}
    </div>
  )
}

export function GuideFrame({ activeStep, children }: {
  activeStep: GuideStep
  children: ReactNode
}) {
  const { t } = useTranslation('deployments')

  return (
    <div className="relative flex h-full min-h-0 overflow-hidden bg-background-default-subtle">
      <div className="flex min-w-0 flex-1 shrink-0 justify-center overflow-hidden">
        <section
          aria-label={t('createGuide.title')}
          className="flex h-full w-full max-w-[840px] flex-col px-5 sm:px-8 lg:px-10"
        >
          <div className="h-5 sm:h-8 lg:h-12" />
          <div className="flex min-w-0 items-start justify-between gap-6 pt-1 pb-4">
            <h1 className="title-2xl-semi-bold text-text-primary">{t('createGuide.title')}</h1>
            <div className="hidden w-[184px] shrink-0 min-[1120px]:block">
              <GuideProgressSummary activeStep={activeStep} />
            </div>
          </div>
          <GuideStepIntro activeStep={activeStep} />
          <div className="mb-6 lg:hidden">
            <GuideProgress activeStep={activeStep} />
          </div>
          {children}
        </section>
      </div>
    </div>
  )
}

export function GuideActions({
  canContinue,
  canSkipDeployment,
  isDeploying,
  isSkippingDeployment,
  step,
  onBack,
  onPrimaryAction,
  onSkipDeployment,
}: {
  canContinue: boolean
  canSkipDeployment: boolean
  isDeploying: boolean
  isSkippingDeployment: boolean
  step: GuideStep
  onBack: () => void
  onPrimaryAction: () => void
  onSkipDeployment: () => void
}) {
  const { t } = useTranslation('deployments')
  const primaryLabel = step === 'target'
    ? isDeploying && !isSkippingDeployment ? t('createGuide.actions.deploying') : t('createGuide.actions.createAndDeploy')
    : step === 'release' && isDeploying
      ? t('createGuide.actions.creating')
      : t('createGuide.actions.next')
  const skipLabel = isSkippingDeployment
    ? t('createGuide.actions.creating')
    : t('createGuide.actions.skipDeploy')

  return (
    <div className="sticky bottom-0 z-10 -mx-5 mt-auto flex items-center justify-end gap-2 border-t border-divider-subtle bg-background-default-subtle/95 px-5 py-4 backdrop-blur-sm sm:-mx-8 sm:px-8 lg:-mx-10 lg:px-10">
      {(step === 'release' || step === 'target') && (
        <Button type="button" variant="secondary" onClick={onBack} disabled={isDeploying}>
          {t('createGuide.actions.back')}
        </Button>
      )}
      {step === 'target' && (
        <Button type="button" variant="secondary" disabled={!canSkipDeployment || isDeploying} onClick={onSkipDeployment}>
          {skipLabel}
        </Button>
      )}
      <Button type="button" variant="primary" disabled={!canContinue || isDeploying} onClick={onPrimaryAction}>
        {primaryLabel}
      </Button>
    </div>
  )
}
