'use client'
import OneMoreStep from './oneMoreStep'
import NormalForm from './normalForm'

type Props = {
  searchParams: { step?: 'next' }
}

const SignIn = ({ searchParams }: Props) => {
  if (searchParams?.step === 'next')
    return <OneMoreStep />

  return <NormalForm />
}

export default SignIn
