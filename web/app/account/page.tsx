'use client'
import { useTranslation } from 'react-i18next'
import AccountPage from './account-page'
import useDocumentTitle from '@/hooks/use-document-title'

export default function Account() {
  const { t } = useTranslation()
  useDocumentTitle(t('common.menus.account'))
  return <div className='max-w-[640px] w-full mx-auto pt-12 px-6'>
    <AccountPage />
  </div>
}
