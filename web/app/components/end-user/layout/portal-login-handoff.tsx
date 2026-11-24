import { Button } from '@langgenius/dify-ui/button'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { MAIN_CONTENT_ID } from '@/app/components/main-nav/skip-link'
import { WEBAPP_PORTAL_LOGIN_CODE } from '@/service/webapp-address'
import { completeWebAppPortalLogin } from '@/service/webapp/portal-login'

export default function PortalLoginHandoff() {
  const { t } = useTranslation(['common'])
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    void completeWebAppPortalLogin().then(
      (destination) => {
        if (active) window.location.replace(destination)
      },
      () => {
        if (active) setFailed(true)
      },
    )
    return () => {
      active = false
    }
  }, [])

  return (
    <main id={MAIN_CONTENT_ID} className="flex h-dvh flex-col items-center justify-center gap-4">
      {failed ? (
        <>
          <p role="alert">{t(($) => $['api.actionFailed'], { ns: 'common' })}</p>
          <Button
            onClick={() => {
              const url = new URL(window.location.href)
              url.searchParams.delete(WEBAPP_PORTAL_LOGIN_CODE)
              window.location.replace(url.href)
            }}
          >
            {t(($) => $['operation.retry'], { ns: 'common' })}
          </Button>
        </>
      ) : (
        <LoadingPlaceholder />
      )}
    </main>
  )
}
