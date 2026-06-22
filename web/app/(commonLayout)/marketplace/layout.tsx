'use client'

import type { PropsWithChildren } from 'react'
import { useTranslation } from 'react-i18next'
import useDocumentTitle from '@/hooks/use-document-title'

export default function MarketplaceLayout({ children }: PropsWithChildren) {
  const { t } = useTranslation()
  useDocumentTitle(t('mainNav.marketplace', { ns: 'common' }))

  return children
}
