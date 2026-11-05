'use client'

import { Button } from '@langgenius/dify-ui/button'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { useLogout } from '@/service/use-common'

export default function SwitchAccount({ redirectTo }: { redirectTo: string }) {
  const { t } = useTranslation(['common'])
  const { mutate, isError, error } = useLogout({ redirectTo })
  const startedRef = useRef(false)

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    mutate()
  }, [mutate])

  if (isError) {
    return (
      <div className="flex flex-col items-center gap-3">
        <p role="alert" className="system-sm-regular text-text-destructive">
          {error.message || t(($) => $['api.actionFailed'], { ns: 'common' })}
        </p>
        <Button onClick={() => mutate()}>{t(($) => $['operation.retry'], { ns: 'common' })}</Button>
      </div>
    )
  }

  return <LoadingPlaceholder className="min-h-48" label={t(($) => $.loading, { ns: 'common' })} />
}
