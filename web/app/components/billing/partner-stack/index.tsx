'use client'
import { IS_CLOUD_EDITION, PARTNER_STACK_CONFIG } from '@/config'
import { useBindPartnerStackInfo } from '@/service/use-billing'
import Cookies from 'js-cookie'
import { useSearchParams } from 'next/navigation'
import type { FC } from 'react'
import React, { useEffect } from 'react'

const PartnerStack: FC = () => {
  const searchParams = useSearchParams()
  const psInfoInCookie = JSON.parse(Cookies.get(PARTNER_STACK_CONFIG.cookieName) || '{}')
  const psPartnerKey = searchParams.get('ps_partner_key') || psInfoInCookie?.partnerKey
  const psClickId = searchParams.get('ps_xid') || psInfoInCookie?.clickId
  const { mutateAsync } = useBindPartnerStackInfo()
  useEffect(() => {
    if (!IS_CLOUD_EDITION)
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
