'use client'

import type { ReactNode } from 'react'
import { useContext } from 'use-context-selector'
import I18NContext from '@/context/i18n'

export type II18NHocProps = {
  children: ReactNode
}

const withI18N = (Component: any) => {
  return (props: any) => {
    const { i18n } = useContext(I18NContext)
    return (
      <Component {...props} i18n={i18n} />
    )
  }
}

export default withI18N
