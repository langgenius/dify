import { getLocaleOnServer, getResources } from '@/i18n-config/server'

import { I18nClientProvider } from './i18n'

export async function I18nServerProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const locale = await getLocaleOnServer()
  const resource = await getResources(locale)

  return (
    <I18nClientProvider
      locale={locale}
      resource={resource}
    >
      {children}
    </I18nClientProvider>
  )
}
