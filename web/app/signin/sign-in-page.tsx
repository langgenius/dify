'use client'
import { useSearchParams } from '@/next/navigation'
import NormalForm from './normal-form'
import OneMoreStep from './one-more-step'

const SignInPage = () => {
  const searchParams = useSearchParams()

  if (searchParams.get('step') === 'next') return <OneMoreStep />
  return <NormalForm />
}

export default SignInPage
