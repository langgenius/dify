'use client'
import { useEducationInit } from '@/app/education-apply/hooks'
import List from './list'
import useDocumentTitle from '@/hooks/use-document-title'
import { useTranslation } from 'react-i18next'

const Apps = () => {
  const { t } = useTranslation()

  useDocumentTitle(t('common.menus.apps'))
  useEducationInit()

  return (
    <div className='relative flex h-0 shrink-0 grow flex-col overflow-y-auto bg-background-body'>
      <List />
    </div >
  )
}

export default Apps
