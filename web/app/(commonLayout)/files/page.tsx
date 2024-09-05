'use client'
import type { FC } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import React, { useEffect } from 'react'
import { useAppContext } from '@/context/app-context'
import Main from '@/app/components/datasets/documents'

const datasetId = '28cc0f54-5762-464d-92c6-d85c9b413a38'

const Layout: FC = () => {
  const { t } = useTranslation()
  const router = useRouter()
  const { isCurrentWorkspaceDatasetOperator } = useAppContext()

  useEffect(() => {
    if (typeof window !== 'undefined')
      document.title = `${t('common.menus.files')}`
    if (isCurrentWorkspaceDatasetOperator)
      return router.replace('/datasets')
  }, [isCurrentWorkspaceDatasetOperator, router, t])

  useEffect(() => {
    if (isCurrentWorkspaceDatasetOperator)
      return router.replace('/datasets')
  }, [isCurrentWorkspaceDatasetOperator, router])

  return <Main datasetId={datasetId} />
}
export default React.memo(Layout)
