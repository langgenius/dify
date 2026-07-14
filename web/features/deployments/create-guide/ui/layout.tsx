'use client'

import type { ReactNode } from 'react'
import type { GuideStep } from '@/features/deployments/create-guide/state/types'
import { cn } from '@langgenius/dify-ui/cn'
import { ScrollArea } from '@langgenius/dify-ui/scroll-area'
import { useTranslation } from 'react-i18next'
import { TitleTooltip } from '@/features/deployments/shared/components/title-tooltip'

const GUIDE_PROGRESS_STEPS: GuideStep[] = ['source', 'release', 'target']

function GuideStepIntro({ activeStep }: { activeStep: GuideStep }) {
  const { t } = useTranslation('deployments')

  let title: string
  let description: string

  if (activeStep === 'source') {
    title = t(($) => $['createGuide.source.title'])
    description = t(($) => $['createGuide.method.description'])
  } else if (activeStep === 'release') {
    title = t(($) => $['createGuide.release.title'])
    description = t(($) => $['createGuide.release.description'])
  } else if (activeStep === 'target') {
    title = t(($) => $['createGuide.target.title'])
    description = t(($) => $['createGuide.target.description'])
  } else {
    return null
  }

  return (
    <div className="pb-4">
      <h2 className="system-md-semibold text-text-primary">{title}</h2>
      <p className="mt-1 max-w-150 system-sm-regular text-text-tertiary">{description}</p>
    </div>
  )
}

function GuideProgress({ activeStep }: { activeStep: GuideStep }) {
  const { t } = useTranslation('deployments')
  const activeIndex = GUIDE_PROGRESS_STEPS.indexOf(activeStep)

  return (
    <ol className="grid grid-cols-3 gap-1.5">
      {GUIDE_PROGRESS_STEPS.map((step, index) => {
        const isActive = step === activeStep
        const isComplete = index < activeIndex
        const label = t(($) => $[`createGuide.steps.${step}`])

        return (
          <TitleTooltip key={step} content={label}>
            <li
              aria-current={isActive ? 'step' : undefined}
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
          </TitleTooltip>
        )
      })}
    </ol>
  )
}

function GuideProgressSummary({ activeStep }: { activeStep: GuideStep }) {
  const { t } = useTranslation('deployments')
  const activeIndex = GUIDE_PROGRESS_STEPS.indexOf(activeStep)
  const activeStepNumber = activeIndex + 1

  let activeStepLabel: string
  if (activeStep === 'source') activeStepLabel = t(($) => $['createGuide.steps.source'])
  else if (activeStep === 'release') activeStepLabel = t(($) => $['createGuide.steps.release'])
  else if (activeStep === 'target') activeStepLabel = t(($) => $['createGuide.steps.target'])
  else return null

  if (activeIndex < 0) return null

  return (
    <div className="flex w-full min-w-0 flex-col gap-2">
      <div className="flex min-w-0 items-baseline justify-between gap-3">
        <span className="truncate system-sm-medium text-text-secondary">{activeStepLabel}</span>
        <span className="shrink-0 system-xs-regular text-text-quaternary">
          {activeStepNumber}/{GUIDE_PROGRESS_STEPS.length}
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

export function StepShell({
  title,
  description,
  descriptionClassName,
  hideHeader,
  className,
  children,
}: {
  title: string
  description: string
  descriptionClassName?: string
  hideHeader?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <section
      aria-label={hideHeader ? title : undefined}
      className={cn('flex min-w-0 flex-col gap-4', className)}
    >
      {!hideHeader && (
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="system-md-semibold text-text-primary">{title}</h2>
          <p className={cn('system-sm-regular text-text-tertiary', descriptionClassName)}>
            {description}
          </p>
        </div>
      )}
      {children}
    </section>
  )
}

export function GuideCard({
  children,
  actions,
  contentScrollable = true,
}: {
  children: ReactNode
  actions: ReactNode
  contentScrollable?: boolean
}) {
  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
      {contentScrollable ? (
        <ScrollArea
          className="min-h-0 flex-1"
          slotClassNames={{
            viewport: 'overscroll-contain',
            content: 'min-h-full pt-0.5 pb-6',
          }}
        >
          {children}
        </ScrollArea>
      ) : (
        <div className="min-h-0 flex-1 overflow-hidden pt-0.5 pb-6">{children}</div>
      )}
      {actions}
    </div>
  )
}

export function GuideFrame({
  activeStep,
  children,
}: {
  activeStep: GuideStep
  children: ReactNode
}) {
  const { t } = useTranslation('deployments')

  return (
    <div className="relative flex h-full min-h-0 overflow-hidden bg-background-default-subtle">
      <div className="flex min-w-0 flex-1 shrink-0 justify-center overflow-hidden">
        <section
          aria-label={t(($) => $['createGuide.title'])}
          className="flex h-full w-full max-w-[840px] flex-col px-5 sm:px-8 lg:px-10"
        >
          <div className="h-5 sm:h-8 lg:h-12" />
          <div className="flex min-w-0 items-start justify-between gap-6 pt-1 pb-4">
            <h1 className="title-2xl-semi-bold text-text-primary">
              {t(($) => $['createGuide.title'])}
            </h1>
            <div className="hidden w-[184px] shrink-0 min-[1120px]:block">
              <GuideProgressSummary activeStep={activeStep} />
            </div>
          </div>
          <GuideStepIntro activeStep={activeStep} />
          <div className="mb-6 min-[1120px]:hidden">
            <GuideProgress activeStep={activeStep} />
          </div>
          {children}
        </section>
      </div>
    </div>
  )
}
