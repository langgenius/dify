'use client'

import { Button } from '@langgenius/dify-ui/button'
import { useTranslation } from 'react-i18next'
import RootLoading from '@/app/loading'
import { isLegacyBase401 } from '@/service/use-common'

type Props = {
  error: Error & { digest?: string }
  unstable_retry: () => void
}

export default function CommonLayoutError({ error, unstable_retry }: Props) {
  const { t } = useTranslation('common')

  // 401 already triggered jumpTo(/signin) inside service/base.ts. Render Loading
  // until the browser navigation completes, matching main's Splash behavior.
  // Showing the "Try again" button here would just flash for a few frames before
  // the page navigates away, and clicking it would 401 again anyway.
  if (isLegacyBase401(error))
    return <RootLoading />

  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-background-body">
      <div className="system-sm-regular text-text-tertiary">
        {t('errorBoundary.message')}
      </div>
      <Button size="small" variant="secondary" onClick={() => unstable_retry()}>
        {t('errorBoundary.tryAgain')}
      </Button>
    </div>
  )
}
