import * as React from 'react'
import { getLocaleOnServer, getResources } from '@/i18n-config/server'
import { ToastProvider } from './base/toast'
import { I18n } from './i18n'

export type II18NServerProps = {
  children: React.ReactNode
}

export async function I18nServer({
  children,
}: II18NServerProps) {
  const locale = await getLocaleOnServer()
  const resource = await getResources(locale)

  return (
    <I18n
      locale={locale}
      resource={resource}
    >
      <ToastProvider>{children}</ToastProvider>
    </I18n>
  )
}
