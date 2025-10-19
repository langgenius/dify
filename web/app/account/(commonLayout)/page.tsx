'use client'
import { useTranslation } from 'react-i18next'
import AccountPage from './account-page'
import useDocumentTitle from '@/hooks/use-document-title'

export default function Account() {
  const { t } = useTranslation()
  useDocumentTitle(t('common.menus.account'))
  return <div className='mx-auto w-full max-w-[640px] px-6 pt-12'>
    <AccountPage />
  </div>
}
