'use client'
import { useSearchParams } from 'next/navigation'
import OneMoreStep from './oneMoreStep'
import NormalForm from './normalForm'

const SignIn = () => {
  const searchParams = useSearchParams()
  const step = searchParams.get('step')

  if (step === 'next')
    return <OneMoreStep />
  return <NormalForm />
}

export default SignIn
