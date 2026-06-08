'use client'

import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { useTranslation } from 'react-i18next'
import Link from '@/next/link'
import { useRouter } from '@/next/navigation'
import { GuideActions, GuideCard, GuideFrame } from './layout'
import { CreationSections } from './source-release-sections'
import { TargetReviewSections } from './target-step'
import { useCreateDeploymentGuide } from './use-create-deployment-guide'

export function CreateDeploymentGuide() {
  const { t } = useTranslation('deployments')
  const router = useRouter()
  const {
    canContinue,
    canSkipDeployment,
    creationSectionsProps,
    handleBack,
    handlePrimaryAction,
    handleSkipDeployment,
    isDeploying,
    isSkippingDeployment,
    showTargetConfiguration,
    step,
    targetReviewSectionsProps,
  } = useCreateDeploymentGuide()

  const guideContent = (
    <>
      {showTargetConfiguration
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
    <Dialog open onOpenChange={open => !open && router.push('/deployments')}>
      <DialogContent
        backdropClassName="bg-background-overlay-backdrop backdrop-blur-[6px]"
        className="top-4 bottom-4 h-auto max-h-none w-[min(calc(100vw-2rem),1120px)] max-w-none translate-y-0 overflow-hidden border-effects-highlight bg-background-default-subtle p-0"
      >
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
              contentScrollable={step !== 'source'}
              actions={(
                <GuideActions
                  canContinue={canContinue}
                  canSkipDeployment={canSkipDeployment}
                  isDeploying={isDeploying}
                  isSkippingDeployment={isSkippingDeployment}
                  step={step}
                  onBack={handleBack}
                  onPrimaryAction={handlePrimaryAction}
                  onSkipDeployment={handleSkipDeployment}
                />
              )}
            >
              {guideContent}
            </GuideCard>
          </GuideFrame>
        </main>
      </DialogContent>
    </Dialog>
  )
}
