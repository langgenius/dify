'use client'
import { IS_CLOUD_EDITION, PARTNER_STACK_CONFIG } from '@/config'
import { useBindPartnerStackInfo } from '@/service/use-billing'
import Cookies from 'js-cookie'
import { usePathname, useSearchParams } from 'next/navigation'
import type { FC } from 'react'
import React, { useEffect } from 'react'

const PartnerStack: FC = () => {
  const path = usePathname()
  const isSignInPage = path === '/signin'
  const searchParams = useSearchParams()
  const psInfoInCookie = JSON.parse(Cookies.get(PARTNER_STACK_CONFIG.cookieName) || '{}')
  const psPartnerKey = searchParams.get('ps_partner_key') || psInfoInCookie?.partnerKey
  const psClickId = searchParams.get('ps_xid') || psInfoInCookie?.clickId
  const { mutateAsync } = useBindPartnerStackInfo()

  useEffect(() => {
    if (!IS_CLOUD_EDITION)
      return

    // Save PartnerStack info in cookie first. Because if user hasn't logged in, redirecting to login page would cause lose the partnerStack info in URL.
    if (!psInfoInCookie && psPartnerKey && psClickId) {
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

    if (isSignInPage)
      return
    (async () => {
      if (IS_CLOUD_EDITION && psPartnerKey && psClickId) {
        await mutateAsync({
          partnerKey: psPartnerKey,
          clickId: psClickId,
        })
        Cookies.remove(PARTNER_STACK_CONFIG.cookieName, { path: '/' })
      }
    })()
  }, [])

  return (
    <>
    </>
  )
}
export default React.memo(PartnerStack)
