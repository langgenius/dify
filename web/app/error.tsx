'use client'

import { Button } from '@langgenius/dify-ui/button'
import { useQueryErrorResetBoundary } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { FullScreenLoading } from '@/app/components/full-screen-loading'
import { isLegacyBase401 } from '@/features/account-profile/client'

type Props = Readonly<{
  error: Error & { digest?: string }
  retry: () => void
}>

export default function AppError({ error, retry }: Props) {
  const { t } = useTranslation('common')
  const { reset: resetQueries } = useQueryErrorResetBoundary()

  console.error(error)

  if (isLegacyBase401(error)) return <FullScreenLoading />

  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-background-body">
      <div className="system-sm-regular text-text-tertiary">
        {t(($) => $['errorBoundary.message'])}
      </div>
      <Button
        size="small"
        variant="secondary"
        onClick={() => {
          resetQueries()
          retry()
        }}
      >
        {t(($) => $['errorBoundary.tryAgain'])}
      </Button>
    </div>
  )
}
