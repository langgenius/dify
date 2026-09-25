'use client'

import { useTranslation } from 'react-i18next'
import useDocumentTitle from '@/hooks/use-document-title'

const MarketplaceDocumentTitle = () => {
  const { t } = useTranslation(['navigation'])
  useDocumentTitle(t(($) => $['mainNav.marketplace'], { ns: 'navigation' }))
  return null
}

export default MarketplaceDocumentTitle
