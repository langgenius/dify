'use client'
import { useTranslation } from '#i18n'
import { DeploymentsList } from '@/features/deployments/list'
import useDocumentTitle from '@/hooks/use-document-title'

export default function DeploymentsPage() {
  const { t } = useTranslation('deployments')
  useDocumentTitle(t('documentTitle.list'))
  return <DeploymentsList />
}
