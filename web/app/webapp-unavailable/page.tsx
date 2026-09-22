import type { Metadata } from '@/next'
import { createInstance } from 'i18next'
import Negotiator from 'negotiator'
import { APP_UNAVAILABLE_IP_HEADER } from '@/features/app-access-error/document-response'
import { getBrowserLocale } from '@/features/app-access-error/locale'
import AppNotAccessible from '@/features/app-access-error/page'
import { loadI18nResource } from '@/i18n-config/load-resource'
import { headers } from '@/next/headers'

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
  const [requestHeaders, share, common, login, fallbackShare, fallbackCommon, fallbackLogin] =
    await Promise.all([
      headers(),
      loadI18nResource(locale, 'share'),
      loadI18nResource(locale, 'common'),
      loadI18nResource(locale, 'login'),
      loadI18nResource('en-US', 'share'),
      loadI18nResource('en-US', 'common'),
      loadI18nResource('en-US', 'login'),
    ])
  return (
    <AppNotAccessible
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
