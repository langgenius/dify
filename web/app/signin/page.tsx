'use client'
import { useSearchParams } from 'next/navigation'
import { useEffect } from 'react'
import usePSInfo from '../components/billing/partner-stack/use-ps-info'
import NormalForm from './normal-form'
import OneMoreStep from './one-more-step'

const SignIn = () => {
  const searchParams = useSearchParams()
  const step = searchParams.get('step')
  const { saveOrUpdate } = usePSInfo()

  useEffect(() => {
    saveOrUpdate()
  }, [])

  if (step === 'next')
    return <OneMoreStep />
  return <NormalForm />
}

export default SignIn
