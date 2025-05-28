'use client'
import { useTranslation } from 'react-i18next'
import Container from './Container'
import useDocumentTitle from '@/hooks/use-document-title'

const AppList = () => {
  const { t } = useTranslation()
  useDocumentTitle(t('common.menus.datasets'))
  return <Container />
}

export default AppList
