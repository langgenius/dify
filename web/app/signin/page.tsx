'use client'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect } from 'react'
import OneMoreStep from './oneMoreStep'
import NormalForm from './normalForm'

const SignIn = () => {
  const router = useRouter()
  const searchParams = useSearchParams()
  const consoleToken = searchParams.get('console_token')
  const invitationCode = searchParams.get('invitation_code')
  useEffect(() => {
    if (consoleToken) {
      localStorage.setItem('console_token', consoleToken)
      if (!invitationCode)
        router.replace('/apps')
    }
  }, [consoleToken, invitationCode, router])
  if (!consoleToken)
    return <NormalForm />
  else if (invitationCode)
    return <OneMoreStep />
  return null
}

export default SignIn
