'use client'

import { Alert, AlertDescription } from '@langgenius/dify-ui/alert'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import { useWebAppEntry } from '../webapp-entry'

export default function UnofficialAppWarning({ className }: { className?: string }) {
  const { t } = useTranslation(['share'])
  const entry = useWebAppEntry()

  if (!entry || !('parameters' in entry) || entry.parameters.connection_requirements.length === 0)
    return null

  return (
    <div className={cn('shrink-0 px-1.5', className)}>
      <Alert type="warning" role="note" className="items-center">
        <AlertDescription>
          {t(($) => $['auth.unofficialAppWarning'], { ns: 'share' })}
        </AlertDescription>
      </Alert>
    </div>
  )
}
