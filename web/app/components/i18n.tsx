'use client'

import type { FC } from 'react'
import React from 'react'
import { changeLanguage } from '@/i18n/i18next-config'
import I18NContext from '@/context/i18n'
import type { Locale } from '@/i18n'
import { getLocaleOnClient, setLocaleOnClient } from '@/i18n/client'

export type II18nProps = {
  locale: Locale
  dictionary: Record<string, any>
  children: React.ReactNode
}
const I18n: FC<II18nProps> = ({
  dictionary,
  children,
  locale,
}) => {
  const clientLocale = getLocaleOnClient()

  // Although this Component has marked the `use client`, but will invoke at the server side at the same time
  // When invoke at the server side, the i18n instance always return the default language, that will cause  the instance language not match the current locale, so we need to force update language
  // This would not invoke at the client side
  if (typeof window === 'undefined')
    locale && changeLanguage(locale)

  return (
    <I18NContext.Provider value={{
      locale: locale || clientLocale,
      i18n: dictionary,
      setLocaleOnClient,
    }}>
      {children}
    </I18NContext.Provider>
  )
}
export default React.memo(I18n)
