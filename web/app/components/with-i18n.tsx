'use client'

import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

export type II18NHocProps = {
  children: ReactNode
}

const withI18N = (Component: any) => {
  return (props: any) => {
    const { i18n } = useTranslation()
    return (
      <Component {...props} i18n={i18n} />
    )
  }
}

export default withI18N
