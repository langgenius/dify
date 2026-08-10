'use client'
import { useTranslation } from 'react-i18next'
import useDocumentTitle from '@/hooks/use-document-title'
import { useSearchParams } from '@/next/navigation'
import NormalForm from './normal-form'
import OneMoreStep from './one-more-step'

const SignIn = () => {
  const { t } = useTranslation()
  const searchParams = useSearchParams()
  const step = searchParams.get('step')
  const documentTitle =
    step === 'next'
      ? t(($) => $.oneMoreStep, { ns: 'login' })
      : t(($) => $.signBtn, { ns: 'login' })
  useDocumentTitle(documentTitle)

  if (step === 'next') return <OneMoreStep />
  return <NormalForm />
}

export default SignIn
