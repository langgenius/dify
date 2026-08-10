'use client'

import { useTranslation } from 'react-i18next'
import AppList from '@/app/components/explore/app-list'
import useDocumentTitle from '@/hooks/use-document-title'

export function HomeClient() {
  const { t } = useTranslation()
  useDocumentTitle(t(($) => $['mainNav.home'], { ns: 'common' }))

  return <AppList />
}
