import React from 'react'
import I18N from './i18n'
import { ToastProvider } from './base/toast'
import { getLocaleOnServer } from '@/i18n/server'

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
