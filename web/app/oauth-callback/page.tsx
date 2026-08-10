'use client'
import { useTranslation } from 'react-i18next'
import useDocumentTitle from '@/hooks/use-document-title'
import { useOAuthCallback } from '@/hooks/use-oauth'

const OAuthCallback = () => {
  const { t } = useTranslation()
  useDocumentTitle(t(($) => $.signBtn, { ns: 'login' }))
  useOAuthCallback()

  return <div />
}

export default OAuthCallback
