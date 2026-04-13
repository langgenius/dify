'use client'
import type { FC } from 'react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import useDocumentTitle from '@/hooks/use-document-title'

export type IAppDetail = {
  children: React.ReactNode
}

const AppDetail: FC<IAppDetail> = ({ children }) => {
  const { t } = useTranslation()
  useDocumentTitle(t('menus.appDetail', { ns: 'common' }))

  return (
    <>
      {children}
    </>
  )
}

export default React.memo(AppDetail)
