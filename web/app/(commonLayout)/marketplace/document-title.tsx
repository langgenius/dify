'use client'

import { useTranslation } from 'react-i18next'
import useDocumentTitle from '@/hooks/use-document-title'

const MarketplaceDocumentTitle = () => {
  const { t } = useTranslation(['common'])
  useDocumentTitle(t(($) => $['mainNav.marketplace'], { ns: 'common' }))
  return null
}

export default MarketplaceDocumentTitle
