'use client'
import type { FC, PropsWithChildren } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import ExploreClient from '@/app/components/explore'
import useDocumentTitle from '@/hooks/use-document-title'

const ExploreLayout: FC<PropsWithChildren> = ({ children }) => {
  const { t } = useTranslation()
  useDocumentTitle(t('common.menus.explore'))
  return (
    <ExploreClient>
      {children}
    </ExploreClient>
  )
}

export default React.memo(ExploreLayout)
