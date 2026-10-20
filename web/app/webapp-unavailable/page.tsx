import type { Metadata } from '@/next'
import { createInstance } from 'i18next'
import Negotiator from 'negotiator'
import { APP_UNAVAILABLE_IP_HEADER } from '@/features/app-access-error/document-constants'
import { getBrowserLocale } from '@/features/app-access-error/locale'
import AppNotAccessible from '@/features/app-access-error/view'
import { loadI18nResource } from '@/i18n/load-resource'
import { headers } from '@/next/headers'
import { consoleClient } from '@/service/console'
import '@/service/console/server'

export const dynamic = 'force-dynamic'

async function documentLocale() {
  const requestHeaders = await headers()
  return getBrowserLocale(
    new Negotiator({
      headers: { 'accept-language': requestHeaders.get('accept-language') ?? '' },
    }).languages(),
  )
}

export async function generateMetadata(): Promise<Metadata> {
  const locale = await documentLocale()
  const resource = await loadI18nResource(locale, 'share')
  const i18n = createInstance()
  await i18n.init({
    lng: locale,
    fallbackLng: false,
    keySeparator: false,
    resources: { [locale]: { share: resource.default } },
  })
  return {
    title: {
      absolute: i18n.getFixedT(locale, 'share')(($) => $['appNotAccessible.documentTitle']),
    },
    robots: { index: false },
  }
}

export default async function UnavailableWebAppDocument() {
  const locale = await documentLocale()
  const [
    requestHeaders,
    share,
    common,
    login,
    fallbackShare,
    fallbackCommon,
    fallbackLogin,
    profile,
  ] = await Promise.all([
    headers(),
    loadI18nResource(locale, 'share'),
    loadI18nResource(locale, 'common'),
    loadI18nResource(locale, 'login'),
    loadI18nResource('en-US', 'share'),
    loadI18nResource('en-US', 'common'),
    loadI18nResource('en-US', 'login'),
    // Identity is optional and time-bounded so profile failures cannot block the error page.
    // Fetch on the server to avoid the client profile query's sign-in redirect.
    consoleClient.account.profile
      .get({}, { signal: AbortSignal.timeout(3000) })
      .catch(() => undefined),
  ])
  return (
    <AppNotAccessible
      account={profile ? { name: profile.name, avatar_url: profile.avatar_url } : undefined}
      clientIp={requestHeaders.get(APP_UNAVAILABLE_IP_HEADER) ?? undefined}
      initialLocale={locale}
      initialResources={{
        'en-US': {
          share: fallbackShare.default,
          common: fallbackCommon.default,
          login: fallbackLogin.default,
        },
        [locale]: { share: share.default, common: common.default, login: login.default },
      }}
    />
  )
}
