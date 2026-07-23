'use client'

import { Button } from '@langgenius/dify-ui/button'
import { useTranslation } from 'react-i18next'
import './styles/globals.css'

type Props = Readonly<{
  error: Error & { digest?: string }
  unstable_retry: () => void
}>

export default function GlobalError({ error, unstable_retry }: Props) {
  const { t } = useTranslation('common')

  console.error(error)

  return (
    <html lang="en" className="h-full">
      <body className="h-full bg-background-body">
        <main className="flex h-full w-full flex-col items-center justify-center gap-4">
          <div className="system-sm-regular text-text-tertiary">
            {t(($) => $['errorBoundary.message'])}
          </div>
          <Button size="small" variant="secondary" onClick={unstable_retry}>
            {t(($) => $['errorBoundary.tryAgain'])}
          </Button>
        </main>
      </body>
    </html>
  )
}
