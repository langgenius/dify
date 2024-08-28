'use client'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect } from 'react'
import OneMoreStep from './oneMoreStep'
import NormalForm from './normalForm'

const SignIn = () => {
  const router = useRouter()
  const searchParams = useSearchParams()
  const consoleToken = searchParams.get('console_token')
  const invitationToken = searchParams.get('token')
  const step = searchParams.get('step')
  useEffect(() => {
    if (invitationToken || step)
      return

    if (consoleToken) {
      localStorage.setItem('console_token', consoleToken)
      router.replace('/apps')
    }
  }, [consoleToken, invitationToken, router, step])
  if (invitationToken || !consoleToken)
    return <NormalForm />
  if (step === 'next')
    return <OneMoreStep />
  return null
}

export default SignIn
