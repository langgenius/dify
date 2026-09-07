'use client'
import type { DeploymentEdition } from '@dify/contracts/api/console/system-features/types.gen'
import type { LangGeniusVersionInfo } from '@/context/app-context-types'
import { buttonVariants } from '@langgenius/dify-ui/button'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import dayjs from 'dayjs'
import { useTranslation } from 'react-i18next'
import { DifyLogo } from '@/app/components/base/logo/dify-logo'
import Link from '@/next/link'

type AccountAboutDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  langGeniusVersionInfo: LangGeniusVersionInfo
  deploymentEdition: DeploymentEdition
}

export default function AccountAboutDialog({
  open,
  onOpenChange,
  langGeniusVersionInfo,
  deploymentEdition,
}: AccountAboutDialogProps) {
  const { t } = useTranslation()
  const isLatest = langGeniusVersionInfo.current_version === langGeniusVersionInfo.latest_version
  const isNonCloudEdition = deploymentEdition === 'COMMUNITY' || deploymentEdition === 'ENTERPRISE'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 text-left">
        <DialogTitle className="sr-only">
          {t(($) => $['userProfile.about'], { ns: 'common' })}
        </DialogTitle>
        <DialogClose
          render={
            <IconButton
              aria-label={t(($) => $['operation.close'], { ns: 'common' })}
              size="lg"
              className="absolute inset-e-6 top-6"
            >
              <span aria-hidden className="i-ri-close-line size-4" />
            </IconButton>
          }
        />
        <div className="flex flex-col items-center gap-4 px-6 py-12">
          <DifyLogo alt="Dify" size="large" className="mx-auto" />

          <div className="text-center system-xs-regular text-text-tertiary">
            Version {langGeniusVersionInfo.current_version}
          </div>
          <div className="flex flex-col items-center gap-2 text-center system-xs-regular text-text-secondary">
            <div>©{dayjs().year()} LangGenius, Inc., Contributors.</div>
            <div className="text-text-accent">
              {isNonCloudEdition && (
                <Link
                  href="https://github.com/langgenius/dify/blob/main/LICENSE"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-sm focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
                >
                  Open Source License
                </Link>
              )}
              {deploymentEdition === 'CLOUD' && (
                <>
                  <Link
                    href="https://dify.ai/privacy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-sm focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
                  >
                    Privacy Policy
                  </Link>
                  ,&nbsp;
                  <Link
                    href="https://dify.ai/terms"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-sm focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
                  >
                    Terms of Service
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-3 border-t border-divider-subtle px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 system-xs-medium text-text-tertiary">
            {isLatest
              ? t(($) => $['about.latestAvailable'], {
                  ns: 'common',
                  version: langGeniusVersionInfo.latest_version,
                })
              : t(($) => $['about.nowAvailable'], {
                  ns: 'common',
                  version: langGeniusVersionInfo.latest_version,
                })}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link
              href="https://github.com/langgenius/dify/releases"
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ size: 'small' })}
            >
              {t(($) => $['about.changeLog'], { ns: 'common' })}
            </Link>
            {!isLatest && deploymentEdition === 'CLOUD' && (
              <Link
                href={langGeniusVersionInfo.release_notes}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonVariants({ variant: 'primary', size: 'small' })}
              >
                {t(($) => $['about.updateNow'], { ns: 'common' })}
              </Link>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
