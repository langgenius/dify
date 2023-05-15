import React from 'react'
import I18N from './i18n'
import { ToastProvider } from './base/toast'
import { getDictionary, getLocaleOnServer } from '@/i18n/server'

export type II18NServerProps = {
  // locale: Locale
  children: React.ReactNode
}

const I18NServer = async ({
  // locale,
  children,
}: II18NServerProps) => {
  const locale = getLocaleOnServer()
  const dictionary = await getDictionary(locale)

  return (
    <I18N {...{ locale, dictionary }}>
      <ToastProvider>{children}</ToastProvider>
    </I18N>
  )
}

export default I18NServer
