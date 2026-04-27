'use client'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import DeploymentsMain from '@/app/components/deployments'
import useDocumentTitle from '@/hooks/use-document-title'

const DeploymentsPage = () => {
  const { t } = useTranslation('deployments')
  useDocumentTitle(t('documentTitle.list'))
  return <DeploymentsMain />
}

export default React.memo(DeploymentsPage)
