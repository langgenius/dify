'use client'
import type { FC, PropsWithChildren } from 'react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import ExploreClient from '@/app/components/explore'
import useDocumentTitle from '@/hooks/use-document-title'

const ExploreLayout: FC<PropsWithChildren> = ({ children }) => {
  const { t } = useTranslation()
  useDocumentTitle(t('menus.explore', { ns: 'common' }))
  return (
    <ExploreClient>
      {children}
    </ExploreClient>
  )
}

export default React.memo(ExploreLayout)
