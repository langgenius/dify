import { getRouteNamespaces } from '@/i18n/route-namespaces'
import { getLocaleOnServer, getResources } from '@/i18n/server'
import { headers } from '@/next/headers'
import { basePath } from '@/utils/var'
import { I18nClientProvider } from './i18n'

export async function I18nServerProvider({ children }: { children: React.ReactNode }) {
  const locale = await getLocaleOnServer()
  const pathname = (await headers()).get('x-dify-pathname')
  const requiredNamespaces = getRouteNamespaces(pathname, basePath)
  const resource = await getResources(locale, requiredNamespaces, true)

  return (
    <I18nClientProvider locale={locale} resource={resource}>
      {children}
    </I18nClientProvider>
  )
}
