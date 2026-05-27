'use client'

import type { ReactNode } from 'react'
import type { GuideStep } from './types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'

const GUIDE_PROGRESS_STEPS: GuideStep[] = ['source', 'release', 'target', 'review']

function GuideProgress({ activeStep }: {
  activeStep: GuideStep
}) {
  const { t } = useTranslation('deployments')
  const activeIndex = GUIDE_PROGRESS_STEPS.indexOf(activeStep)

  return (
    <ol className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {GUIDE_PROGRESS_STEPS.map((step, index) => {
        const isActive = step === activeStep
        const isComplete = activeIndex > index || activeStep === 'done'

        return (
          <li
            key={step}
            className={cn(
              'flex min-w-0 items-center gap-2 rounded-lg border px-3 py-2 system-xs-medium',
              isActive
                ? 'border-state-accent-solid bg-state-accent-hover text-text-accent'
                : isComplete
                  ? 'border-util-colors-green-green-200 bg-util-colors-green-green-50 text-util-colors-green-green-700'
                  : 'border-divider-subtle bg-background-default text-text-tertiary',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'flex size-5 shrink-0 items-center justify-center rounded-full system-2xs-medium',
                isComplete
                  ? 'bg-util-colors-green-green-600 text-text-primary-on-surface'
                  : isActive
                    ? 'bg-primary-600 text-text-primary-on-surface'
                    : 'bg-background-section-burn text-text-tertiary',
              )}
            >
              {isComplete ? <span className="i-ri-check-line size-3.5" /> : index + 1}
            </span>
            <span className="truncate">{t(`createGuide.steps.${step}`)}</span>
          </li>
        )
      })}
    </ol>
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
    <div className="flex w-full min-w-0 flex-col">
      <div className="min-h-0">
        {children}
      </div>
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
    <div className="flex h-full min-h-0 overflow-hidden bg-background-default-subtle">
      <div className="flex min-w-0 flex-1 shrink-0 justify-center overflow-y-auto">
        <section
          aria-label={t('createGuide.title')}
          className="w-full max-w-[840px] px-5 sm:px-8 lg:px-10"
        >
          <div className="h-5 sm:h-8 lg:h-12" />
          <div className="pt-1 pb-5">
            <h1 className="title-2xl-semi-bold text-text-primary">{t('createGuide.title')}</h1>
            <p className="mt-1 max-w-150 system-sm-regular text-text-tertiary">
              {t('createGuide.review.description')}
            </p>
          </div>
          {activeStep !== 'done' && <GuideProgress activeStep={activeStep} />}
          {children}
        </section>
      </div>
    </div>
  )
}

export function GuideActions({
  canContinue,
  isDeploying,
  step,
  onBack,
  onPrimaryAction,
}: {
  canContinue: boolean
  isDeploying: boolean
  step: GuideStep
  onBack: () => void
  onPrimaryAction: () => void
}) {
  const { t } = useTranslation('deployments')
  const primaryLabel = step === 'target'
    ? t('createGuide.actions.review')
    : step === 'review'
      ? isDeploying ? t('createGuide.actions.deploying') : t('createGuide.actions.deploy')
      : step === 'release' && isDeploying
        ? t('createGuide.actions.creating')
        : t('createGuide.actions.next')

  if (step === 'method' || step === 'done')
    return null

  return (
    <div className="flex items-center justify-end gap-2 pt-5 pb-10">
      {(step === 'release' || step === 'target' || step === 'review') && (
        <Button type="button" variant="secondary" onClick={onBack} disabled={isDeploying}>
          {t('createGuide.actions.back')}
        </Button>
      )}
      <Button type="button" variant="primary" disabled={!canContinue || isDeploying} onClick={onPrimaryAction}>
        {primaryLabel}
      </Button>
    </div>
  )
}
