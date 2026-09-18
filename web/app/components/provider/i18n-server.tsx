import { getInitialNamespacesForPath } from '@/i18n-config/initial-namespaces'
import { getLocaleOnServer, getResourcesForPath } from '@/i18n-config/server'
import { headers } from '@/next/headers'
import { I18nClientProvider } from './i18n'

const CURRENT_PATHNAME_HEADER = 'x-dify-pathname'

export async function I18nServerProvider({ children }: { children: React.ReactNode }) {
  const requestHeaders = await headers()
  const pathname = requestHeaders.get(CURRENT_PATHNAME_HEADER) ?? '/'
  const locale = await getLocaleOnServer()
  const initialNamespaces = getInitialNamespacesForPath(pathname)
  const resource = await getResourcesForPath(locale, pathname)

  return (
    <I18nClientProvider
      locale={locale}
      resource={resource}
      initialNamespaces={initialNamespaces}
    >
      {children}
    </I18nClientProvider>
  )
}
