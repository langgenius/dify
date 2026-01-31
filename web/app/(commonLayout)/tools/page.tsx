'use client'
import type { FC } from 'react'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import ToolProviderList from '@/app/components/tools/provider-list'
import { useAppContext } from '@/context/app-context'
import useDocumentTitle from '@/hooks/use-document-title'

const ToolsList: FC = () => {
  const router = useRouter()
  const { isCurrentWorkspaceDatasetOperator } = useAppContext()
  const { t } = useTranslation()
  useDocumentTitle(t('menus.tools', { ns: 'common' }))

  useEffect(() => {
    if (isCurrentWorkspaceDatasetOperator)
      return router.replace('/datasets')
  }, [isCurrentWorkspaceDatasetOperator, router])

  return <ToolProviderList />
}
export default React.memo(ToolsList)
