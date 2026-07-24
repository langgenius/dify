'use client'
import { useTranslation } from 'react-i18next'
import useDocumentTitle from '@/hooks/use-document-title'
import AccountPage from './account-page'

export default function Account() {
  const { t } = useTranslation()
  useDocumentTitle(t('menus.account', { ns: 'common' }))
  return (
    <div className="mx-auto w-full max-w-[640px] px-6 pt-12">
      <AccountPage />
    </div>
  )
}
