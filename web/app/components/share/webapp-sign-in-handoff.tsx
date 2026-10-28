'use client'

import type { PropsWithChildren } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { useSearchParams } from '@/next/navigation'
import { resolveWebAppAddress } from '@/service/webapp-address'
import useWebAppSignIn, { WEBAPP_SIGN_IN_HANDOFF } from './use-webapp-sign-in'
import { useWebAppEntry } from './webapp-entry'

export default function WebAppSignInHandoff({ children }: PropsWithChildren) {
  const params = useSearchParams()
  const entry = useWebAppEntry()
  const { signIn, error } = useWebAppSignIn()
  const { t } = useTranslation(['common'])
  const startedRef = useRef(false)
  const requested =
    params.get(WEBAPP_SIGN_IN_HANDOFF) === '1' && resolveWebAppAddress()?.kind === 'default'
  const account = entry && 'account' in entry ? entry.account : 'loading'
  const loginEnabled = entry && 'parameters' in entry && entry.parameters.account_login_enabled

  useEffect(() => {
    if (!requested || account === 'loading' || account === 'unavailable' || startedRef.current)
      return
    startedRef.current = true
    if (account === 'authenticated' || !loginEnabled) {
      const target = new URL(window.location.href)
      target.searchParams.delete(WEBAPP_SIGN_IN_HANDOFF)
      window.location.replace(target.href)
    } else signIn()
  }, [requested, account, loginEnabled, signIn])

  if (!requested) return children
  if (!error && account !== 'unavailable')
    return (
      <main className="flex h-full items-center justify-center">
        <LoadingPlaceholder />
      </main>
    )
  return (
    <main className="flex h-full flex-col items-center justify-center gap-4 p-6">
      <p role="alert">{t(($) => $['api.actionFailed'], { ns: 'common' })}</p>
      <Button onClick={() => (account === 'unavailable' ? window.location.reload() : signIn())}>
        {t(($) => $['operation.retry'], { ns: 'common' })}
      </Button>
    </main>
  )
}
