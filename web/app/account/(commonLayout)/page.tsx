'use client'
import { useTranslation } from 'react-i18next'
import useDocumentTitle from '@/hooks/use-document-title'
import AccountPage from './account-page'

export default function Account() {
  const { t } = useTranslation(['navigation'])
  useDocumentTitle(t(($) => $['menus.account'], { ns: 'navigation' }))
  return (
    <div className="mx-auto w-full max-w-252 px-6 pt-12">
      <AccountPage />
    </div>
  )
}
