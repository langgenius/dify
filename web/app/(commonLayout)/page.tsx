'use client'

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import AppList from '@/app/components/explore/app-list'
import useDocumentTitle from '@/hooks/use-document-title'

const Home = () => {
  const { t } = useTranslation()
  useDocumentTitle(t('mainNav.home', { ns: 'common' }))

  return <AppList />
}

export default React.memo(Home)
