'use client'

import { useTranslation } from 'react-i18next'
import useDocumentTitle from '@/hooks/use-document-title'

export function HomeTitle() {
  const { t } = useTranslation()
  useDocumentTitle(t(($) => $['mainNav.home'], { ns: 'common' }))

  return null
}
