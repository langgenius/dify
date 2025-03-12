'use client'

import type { FC } from 'react'
import React, { useEffect } from 'react'
import I18NContext from '@/context/i18n'
import type { Locale } from '@/i18n'
import { setLocaleOnClient } from '@/i18n'

export type II18nProps = {
  locale: Locale
  children: React.ReactNode
}
const I18n: FC<II18nProps> = ({
  locale,
  children,
}) => {
  useEffect(() => {
    setLocaleOnClient(locale, false)
  }, [locale])

  return (
    <I18NContext.Provider value={{
      locale,
      i18n: {},
      setLocaleOnClient,
    }}>
      {children}
    </I18NContext.Provider>
  )
}
export default React.memo(I18n)
