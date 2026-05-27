'use client'

import { useTranslation } from 'react-i18next'
import Link from '@/next/link'
import { DoneStep } from './done-step'
import { GuideActions, GuideCard, GuideFrame } from './layout'
import { DeploymentSummaryPreview, ReviewStep } from './review-step'
import { CreationSections } from './source-release-sections'
import { TargetReviewSections } from './target-step'
import { useCreateDeploymentGuide } from './use-create-deployment-guide'

export function CreateDeploymentGuide() {
  const { t } = useTranslation('deployments')
  const {
    canContinue,
    creationSectionsProps,
    deployedEnvironmentName,
    deploymentPreviewProps,
    handleBack,
    handlePrimaryAction,
    isDeploying,
    selectedTargetEnvironmentName,
    showTargetConfiguration,
    step,
    targetReviewSectionsProps,
  } = useCreateDeploymentGuide()

  const deploymentPreview = (
    <DeploymentSummaryPreview {...deploymentPreviewProps} />
  )

  const guideContent = (
    <>
      {step === 'done'
        ? (
            <DoneStep environmentName={deployedEnvironmentName || selectedTargetEnvironmentName} />
          )
        : step === 'review'
          ? (
              <ReviewStep preview={deploymentPreview} />
            )
          : showTargetConfiguration
            ? (
                <div className="flex flex-col gap-7 pb-4">
                  <TargetReviewSections {...targetReviewSectionsProps} />
                </div>
              )
            : (
                <CreationSections {...creationSectionsProps} />
              )}
    </>
  )

  return (
    <div className="fixed inset-0 z-50 bg-background-overlay-backdrop p-4 backdrop-blur-[6px]">
      <div className="h-full w-full overflow-hidden rounded-2xl border border-effects-highlight bg-background-default-subtle">
        <main className="relative flex h-full min-w-0 grow flex-col overflow-hidden">
          <Link
            href="/deployments"
            aria-label={t('createGuide.nav.back')}
            className="absolute top-3 right-3 z-50 flex h-9 w-9 cursor-pointer items-center justify-center rounded-[10px] bg-components-button-tertiary-bg hover:bg-components-button-tertiary-bg-hover"
          >
            <span aria-hidden="true" className="i-ri-close-large-line h-3.5 w-3.5 text-components-button-tertiary-text" />
          </Link>
          <GuideFrame activeStep={step}>
            <GuideCard
              actions={(
                <GuideActions
                  canContinue={canContinue}
                  isDeploying={isDeploying}
                  step={step}
                  onBack={handleBack}
                  onPrimaryAction={handlePrimaryAction}
                />
              )}
            >
              {guideContent}
            </GuideCard>
          </GuideFrame>
        </main>
      </div>
    </div>
  )
}
