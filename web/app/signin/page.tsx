'use client'
import { useSearchParams } from 'next/navigation'
import OneMoreStep from './one-more-step'
import NormalForm from './normal-form'
import { IS_CLOUD_EDITION, PARTNER_STACK_CONFIG } from '@/config'
import { useEffect } from 'react'
import Cookies from 'js-cookie'

const SignIn = () => {
  const searchParams = useSearchParams()
  const step = searchParams.get('step')
  const psPartnerKey = IS_CLOUD_EDITION ? searchParams.get('ps_partner_key') : null
  const psClickId = IS_CLOUD_EDITION ? searchParams.get('ps_xid') : null

  useEffect(() => {
    if (psPartnerKey && psClickId) {
      Cookies.set(PARTNER_STACK_CONFIG.cookieName, JSON.stringify({
        partnerKey: psPartnerKey,
        clickId: psClickId,
      }), {
        expires: PARTNER_STACK_CONFIG.saveCookieDays,
        path: '/',
        // Save to top domain. cloud.dify.ai => .dify.ai
        domain: globalThis.location.hostname.replace('cloud', ''),
      })
    }
  }, [psPartnerKey, psClickId])

  if (step === 'next')
    return <OneMoreStep />
  return <NormalForm />
}

export default SignIn
