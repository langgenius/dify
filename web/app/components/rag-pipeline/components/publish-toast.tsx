import { Alert, AlertClose, AlertDescription, AlertTitle } from '@langgenius/dify-ui/alert'
import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '@/app/components/workflow/store'

const PublishToast = () => {
  const { t } = useTranslation(['common', 'pipeline'])
  const publishedAt = useStore((s) => s.publishedAt)
  const [hideToast, setHideToast] = useState(false)

  if (publishedAt || hideToast) return null

  return (
    <div className="nokey pointer-events-none absolute inset-x-0 bottom-11.25 z-10 flex justify-center">
      <Alert type="info" className="pointer-events-auto w-105">
        <AlertTitle>{t(($) => $['publishToast.title'], { ns: 'pipeline' })}</AlertTitle>
        <AlertDescription>{t(($) => $['publishToast.desc'], { ns: 'pipeline' })}</AlertDescription>
        <AlertClose
          aria-label={t(($) => $['operation.close'], { ns: 'common' })}
          onClick={() => setHideToast(true)}
        />
      </Alert>
    </div>
  )
}

export default memo(PublishToast)
