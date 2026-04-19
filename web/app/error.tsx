'use client'

import { Button } from '@langgenius/dify-ui/button'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { IS_DEV } from '@/config'

type Props = {
  error: Error & { digest?: string }
  unstable_retry: () => void
}

export default function RootError({ error, unstable_retry }: Props) {
  const { t } = useTranslation('common')

  useEffect(() => {
    if (IS_DEV)
      console.error('app/error.tsx caught error:', error)
  }, [error])

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
