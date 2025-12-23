import * as React from 'react'
import { getLocaleOnServer } from '@/i18n-config/server'
import { ToastProvider } from './base/toast'
import I18N from './i18n'

export type II18NServerProps = {
  children: React.ReactNode
}

const I18NServer = async ({
  children,
}: II18NServerProps) => {
  const locale = await getLocaleOnServer()

  return (
    <I18N {...{ locale }}>
      <ToastProvider>{children}</ToastProvider>
    </I18N>
  )
}

export default I18NServer
