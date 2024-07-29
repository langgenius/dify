'use client'
import type { FC } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import React, { useEffect } from 'react'
import ToolProviderList from '@/app/components/tools/provider-list'
import { useAppContext } from '@/context/app-context'

const Layout: FC = () => {
  const { t } = useTranslation()
  const router = useRouter()
  const { isCurrentWorkspaceDatasetOperator } = useAppContext()

  useEffect(() => {
    if (typeof window !== 'undefined')
      document.title = `${t('tools.title')} - Dify`
    if (isCurrentWorkspaceDatasetOperator)
      return router.replace('/datasets')
  }, [isCurrentWorkspaceDatasetOperator, router, t])

  useEffect(() => {
    if (isCurrentWorkspaceDatasetOperator)
      return router.replace('/datasets')
  }, [isCurrentWorkspaceDatasetOperator, router])

  return <ToolProviderList />
}
export default React.memo(Layout)
