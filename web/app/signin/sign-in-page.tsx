'use client'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { useSearchParams } from '@/next/navigation'
import NormalForm from './normal-form'
import OneMoreStep from './one-more-step'
import SwitchAccount from './switch-account'
import { getEndUserLoginContext, isEndUserSignIn } from './utils/end-user-login'

const SignInPage = () => {
  const searchParams = useSearchParams()
  const { t } = useTranslation(['accountSettings'])

  useEffect(() => {
    const url = new URL(window.location.href)
    if (url.searchParams.get('account_deleted') !== 'true') return

    url.searchParams.delete('account_deleted')
    window.history.replaceState(window.history.state, '', url)
    toast.info(t(($) => $['account.deleteSuccessTip'], { ns: 'accountSettings' }))
  }, [t])

  if (searchParams.get('switch_account') === '1' && getEndUserLoginContext(searchParams)) {
    // End the Console session on its own origin before the login probe can reuse it.
    const params = new URLSearchParams(searchParams.toString())
    params.delete('switch_account')
    return <SwitchAccount redirectTo={`/signin?${params.toString()}`} />
  }

  if (!isEndUserSignIn(searchParams) && searchParams.get('step') === 'next') return <OneMoreStep />
  return <NormalForm />
}

export default SignInPage
