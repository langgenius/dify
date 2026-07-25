'use client'

import { useTranslation } from 'react-i18next'
import { CreateDeploymentGuide } from '@/features/deployments/create-guide'
import useDocumentTitle from '@/hooks/use-document-title'

export default function CreateDeploymentPage() {
  const { t } = useTranslation('deployments')
  useDocumentTitle(t(($) => $['documentTitle.create']))

  return <CreateDeploymentGuide />
}
