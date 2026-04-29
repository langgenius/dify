'use client'
import { useEffect } from 'react'
import RootLoading from '@/app/loading'
import { useRouter, useSearchParams } from '@/next/navigation'
import NormalForm from '@/app/signin/normal-form'
import { createAuthSearchParams } from '@/app/signin/utils/post-login-redirect'

const SignIn = () => {
  const router = useRouter()
  const searchParams = useSearchParams()
  const step = searchParams.get('step')

  useEffect(() => {
    if (step !== 'next')
      return

    const params = createAuthSearchParams(searchParams)
    params.delete('step')
    const queryString = params.toString()
    router.replace(queryString ? `/signin/next?${queryString}` : '/signin/next')
  }, [router, searchParams, step])

  if (step === 'next')
    return <RootLoading />

  return <NormalForm />
}

export default SignIn
