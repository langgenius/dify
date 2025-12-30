import { useBoolean } from 'ahooks'
import Cookies from 'js-cookie'
import { useSearchParams } from 'next/navigation'
import { useCallback } from 'react'
import { PARTNER_STACK_CONFIG } from '@/config'
import { useBindPartnerStackInfo } from '@/service/use-billing'

const usePSInfo = () => {
  const searchParams = useSearchParams()
  const psInfoInCookie = (() => {
    try {
      return JSON.parse(Cookies.get(PARTNER_STACK_CONFIG.cookieName) || '{}')
    }
    catch (e) {
      console.error('Failed to parse partner stack info from cookie:', e)
      return {}
    }
  })()
  const psPartnerKey = searchParams.get('ps_partner_key') || psInfoInCookie?.partnerKey
  const psClickId = searchParams.get('ps_xid') || psInfoInCookie?.clickId
  const isPSChanged = psInfoInCookie?.partnerKey !== psPartnerKey || psInfoInCookie?.clickId !== psClickId
  const [hasBind, {
    setTrue: setBind,
  }] = useBoolean(false)
  const { mutateAsync } = useBindPartnerStackInfo()
  // Save to top domain. cloud.dify.ai => .dify.ai
  const domain = globalThis.location.hostname.replace('cloud', '')

  const saveOrUpdate = useCallback(() => {
    if (!psPartnerKey || !psClickId)
      return
    if (!isPSChanged)
      return
    Cookies.set(PARTNER_STACK_CONFIG.cookieName, JSON.stringify({
      partnerKey: psPartnerKey,
      clickId: psClickId,
    }), {
      expires: PARTNER_STACK_CONFIG.saveCookieDays,
      path: '/',
      domain,
    })
  }, [psPartnerKey, psClickId, isPSChanged])

  const bind = useCallback(async () => {
    if (psPartnerKey && psClickId && !hasBind) {
      let shouldRemoveCookie = false
      try {
        await mutateAsync({
          partnerKey: psPartnerKey,
          clickId: psClickId,
        })
        shouldRemoveCookie = true
      }
      catch (error: unknown) {
        if ((error as { status: number })?.status === 400)
          shouldRemoveCookie = true
      }
      if (shouldRemoveCookie)
        Cookies.remove(PARTNER_STACK_CONFIG.cookieName, { path: '/', domain })
      setBind()
    }
  }, [psPartnerKey, psClickId, mutateAsync, hasBind, setBind])
  return {
    psPartnerKey,
    psClickId,
    saveOrUpdate,
    bind,
  }
}
export default usePSInfo
