'use client'

import { Button } from '@langgenius/dify-ui/button'
import { useTranslation } from 'react-i18next'
import { FullScreenLoading } from '@/app/components/full-screen-loading'
import { isLegacyBase401 } from '@/features/account-profile/client'

type Props = {
  error: Error & { digest?: string }
  reset?: () => void
  unstable_retry?: () => void
}

export default function AppError({ error, reset, unstable_retry }: Props) {
  const { t } = useTranslation('common')
  const retry = reset ?? unstable_retry

  console.error(error)

  if (isLegacyBase401(error)) return <FullScreenLoading />

  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-background-body">
      <div className="system-sm-regular text-text-tertiary">
        {t(($) => $['errorBoundary.message'])}
      </div>
      {retry && (
        <Button size="small" variant="secondary" onClick={() => retry()}>
          {t(($) => $['errorBoundary.tryAgain'])}
        </Button>
      )}
    </div>
  )
}
