'use client'
import { useEducationInit } from '@/app/education-apply/hooks'
import { useGlobalPublicStore } from '@/context/global-public-context'
import List from './list'
import Footer from './footer'
import useDocumentTitle from '@/hooks/use-document-title'
import { useTranslation } from 'react-i18next'

const Apps = () => {
  const { t } = useTranslation()
  const { systemFeatures } = useGlobalPublicStore()

  useDocumentTitle(t('common.menus.apps'))
  useEducationInit()

  return (
    <div className='relative flex h-0 shrink-0 grow flex-col overflow-y-auto bg-background-body'>
      <List />
      {!systemFeatures.branding.enabled && (
        <Footer />
      )}
    </div >
  )
}

export default Apps
