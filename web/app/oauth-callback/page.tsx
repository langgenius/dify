'use client'
import { useTranslation } from 'react-i18next'
import { useOAuthCallback } from '@/hooks/use-oauth'

const OAuthCallback = () => {
  const { t } = useTranslation()
  const { status, errorDescription } = useOAuthCallback()

  const isSuccess = status === 'success'

  return (
    <div className="flex min-h-screen items-center justify-center bg-background-body px-6">
      <div className="flex max-w-md flex-col items-center gap-2 text-center">
        <p
          className={`system-lg-semibold ${isSuccess ? 'text-text-success' : 'text-text-destructive'}`}
        >
          {isSuccess
            ? t(($) => $['modal.oauth.authorization.authSuccess'], { ns: 'pluginTrigger' })
            : t(($) => $['modal.oauth.authorization.authFailed'], { ns: 'pluginTrigger' })}
        </p>
        {!isSuccess && errorDescription && (
          <p className="system-sm-regular text-text-secondary">{errorDescription}</p>
        )}
        <p className="system-sm-regular text-text-tertiary">
          {t(($) => $['modal.oauth.authorization.waitingJump'], { ns: 'pluginTrigger' })}
        </p>
      </div>
    </div>
  )
}

export default OAuthCallback
