'use client'
import { useSearchParams } from '@/next/navigation'
import NormalForm from './normal-form'
import OneMoreStep from './one-more-step'

const SignIn = () => {
  const searchParams = useSearchParams()
  const step = searchParams.get('step')

  if (step === 'next')
    return <OneMoreStep />
  return <NormalForm />
}

export default SignIn
