'use client'

import { useMutation } from '@tanstack/react-query'
import { resolveWebAppAddress } from '@/service/webapp-address'
import { beginWebAppAccountLogin } from '@/service/webapp/login'
import useSignInUrl from './use-sign-in-url'

export default function useWebAppSignIn() {
  const signInUrl = useSignInUrl()
  const operation = useMutation({
    mutationFn: async () => {
      const address = resolveWebAppAddress()
      if (address?.kind === 'default') {
        const target = await beginWebAppAccountLogin(signInUrl, window.location.href)
        window.location.assign(target)
      } else window.location.assign(signInUrl)
    },
  })
  return { signIn: () => operation.mutate(), pending: operation.isPending, error: operation.error }
}
