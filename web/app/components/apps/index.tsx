'use client'
import { useTranslation } from 'react-i18next'
import { useEducationInit } from '@/app/education-apply/hooks'
import useDocumentTitle from '@/hooks/use-document-title'
import List from './list'

const Apps = () => {
  const { t } = useTranslation()

  useDocumentTitle(t('menus.apps', { ns: 'common' }))
  useEducationInit()

  return (
    <div className="relative flex h-0 shrink-0 grow flex-col overflow-y-auto bg-background-body">
      <List />
    </div>
  )
}

export default Apps
