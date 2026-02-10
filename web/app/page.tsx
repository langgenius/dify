'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import Loading from '@/app/components/base/loading'
import { OAUTH_AUTHORIZE_PENDING_KEY } from '@/app/account/oauth/authorize/constants'
import { getOAuthPendingRedirect } from '@/app/signin/utils/post-login-redirect'

const Home = () => {
  const router = useRouter()

  useEffect(() => {
    const pendingRedirect = getOAuthPendingRedirect(OAUTH_AUTHORIZE_PENDING_KEY)
    if (pendingRedirect) {
      router.replace(pendingRedirect)
      return
    }
    router.replace('/apps')
  }, [router])

  return (
    <div className="flex min-h-screen flex-col justify-center py-12 sm:px-6 lg:px-8">

      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <Loading type="area" />
        <div className="mt-10 text-center">
          <Link href="/apps">🚀</Link>
        </div>
      </div>
    </div>
  )
}

export default Home
