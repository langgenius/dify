'use client'

import { useTranslation } from 'react-i18next'
import useDocumentTitle from '@/hooks/use-document-title'
import { HomeContent } from './components/home-content/home-content'

export function HomeClient() {
  const { t } = useTranslation()
  useDocumentTitle(t(($) => $['mainNav.home'], { ns: 'common' }))

  return <HomeContent />
}
