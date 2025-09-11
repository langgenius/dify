'use client'

import type { ReactNode } from 'react'
import { use } from 'react'
import I18NContext from '@/context/i18n'

export type II18NHocProps = {
  children: ReactNode
}

const withI18N = (Component: any) => {
  return (props: any) => {
    const { i18n } = use(I18NContext)
    return (
      <Component {...props} i18n={i18n} />
    )
  }
}

export default withI18N
