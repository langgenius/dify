'use client'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { useSearchParams } from '@/next/navigation'
import NormalForm from './normal-form'
import OneMoreStep from './one-more-step'

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

  if (searchParams.get('step') === 'next') return <OneMoreStep />
  return <NormalForm />
}

export default SignInPage
