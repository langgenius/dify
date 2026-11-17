'use client'

import {
  DialogBackdrop,
  DialogClose,
  DialogPopup,
  DialogPortal,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { lazy, Suspense, useLayoutEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'

const InstalledApp = lazy(() => import('.'))

function InstalledAppSession({ appId }: { appId: string }) {
  useLayoutEffect(() => {
    const previousTitle = document.title
    return () => {
      document.title = previousTitle
    }
  }, [])

  return (
    <Suspense fallback={<LoadingPlaceholder className="flex h-full items-center justify-center" />}>
      <InstalledApp key={appId} id={appId} embedded />
    </Suspense>
  )
}

export default function InstalledAppDialogContent({ appId }: { appId: string }) {
  const { t } = useTranslation(['navigation', 'common'])
  return (
    <DialogPortal>
      <DialogBackdrop />
      <DialogPopup className="fixed inset-6 flex min-h-0 flex-col rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-xl max-sm:inset-2">
        <DialogTitle className="sr-only">
          {t(($) => $['mainNav.publishedApps'], { ns: 'navigation' })}
        </DialogTitle>
        <div className="min-h-0 flex-1 overflow-hidden rounded-[inherit]">
          <InstalledAppSession appId={appId} />
        </div>
        <DialogClose
          render={
            <IconButton
              variant="secondary"
              size="xl"
              aria-label={t(($) => $['operation.close'], { ns: 'common' })}
              className="absolute -end-3 -top-3 rounded-full shadow-md max-sm:end-1 max-sm:top-1"
            >
              <span aria-hidden className="i-ri-close-line size-5" />
            </IconButton>
          }
        />
      </DialogPopup>
    </DialogPortal>
  )
}
