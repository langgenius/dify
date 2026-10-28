'use client'

import { useMutation } from '@tanstack/react-query'
import { useCallback } from 'react'
import { resolveWebAppAddress } from '@/service/webapp-address'
import { beginWebAppAccountLogin } from '@/service/webapp/login'
import useSignInUrl from './use-sign-in-url'

export const WEBAPP_SIGN_IN_HANDOFF = '_dify_signin'

export default function useWebAppSignIn() {
  const signInUrl = useSignInUrl()
  const operation = useMutation({
    mutationFn: async () => {
      const address = resolveWebAppAddress()
      if (address?.kind === 'default') {
        const returnUrl = new URL(window.location.href)
        returnUrl.searchParams.delete(WEBAPP_SIGN_IN_HANDOFF)
        if (window.top && window.top !== window) {
          // Start PKCE in the returning top-level tab, where its sessionStorage survives login.
          returnUrl.searchParams.set(WEBAPP_SIGN_IN_HANDOFF, '1')
          window.top.location.href = returnUrl.href
          return
        }
        const target = await beginWebAppAccountLogin(signInUrl, returnUrl.href)
        window.location.assign(target)
      } else window.location.assign(signInUrl)
    },
  })
  const { mutate } = operation
  const signIn = useCallback(() => mutate(), [mutate])
  return { signIn, pending: operation.isPending, error: operation.error }
}
