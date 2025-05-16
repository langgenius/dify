'use client'

import useDocumentTitle from '@/hooks/use-document-title'
import { useTranslation } from 'react-i18next'

export default function DatasetsLayout({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation()
  useDocumentTitle(t('common.menus.apps'))
  return (<>
    {children}
  </>)
}
