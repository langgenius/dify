import { getLocaleOnServer, getResources } from '@/i18n/server'
import { headers } from '@/next/headers'
import { I18nClientProvider } from './i18n'

export async function I18nServerProvider({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get('x-nonce') ?? undefined
  const locale = await getLocaleOnServer()
  const resource = await getResources(locale, ['common'], true)

  return (
    <I18nClientProvider locale={locale} resource={resource} nonce={nonce}>
      {children}
    </I18nClientProvider>
  )
}
