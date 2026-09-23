import type { ThemeProviderProps } from 'next-themes'
import type { Metadata, Viewport } from '@/next'
import { TooltipProvider } from '@langgenius/dify-ui/tooltip'
import { HydrationBoundary } from '@tanstack/react-query'
import { Provider as JotaiProvider } from 'jotai/react'
import Negotiator from 'negotiator'
import { ThemeProvider } from 'next-themes'
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import { AppToastHost } from '@/app/notifications/host'
import { IS_PROD } from '@/config'
import { getDatasetMap } from '@/env'
import AppAccessBoundary from '@/features/app-access-error/boundary'
import { APP_UNAVAILABLE_PATH } from '@/features/app-access-error/document-response'
import { getBrowserLocale } from '@/features/app-access-error/locale'
import { SystemFeaturesBootstrapBoundary } from '@/features/system-features/bootstrap-boundary'
import {
  dehydrateSystemFeatures,
  getOptionalSystemFeatures,
} from '@/features/system-features/server'
import { getLocaleOnServer } from '@/i18n/server'
import { headers } from '@/next/headers'
import { getApplicationTitle } from '@/utils/document-title'
import { basePath } from '@/utils/var'
import { CloudAnalytics } from './components/base/analytics-consent/cloud-analytics'
import { PartnerStackCookieRecorder } from './components/billing/partner-stack/cookie-recorder'
import { AgentationLoader } from './components/devtools/agentation-loader'
import { ReactScanLoader } from './components/devtools/react-scan/loader'
import { I18nServerProvider } from './components/provider/i18n-server'
import { TanStackQueryProvider } from './query-provider'
import '@/service/console/server'
import './styles/globals.css'
import './styles/markdown.css'

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export async function generateMetadata(): Promise<Metadata> {
  if ((await headers()).get('x-dify-pathname') === APP_UNAVAILABLE_PATH)
    return { icons: { icon: `${basePath}/favicon.ico` } }
  const systemFeatures = await getOptionalSystemFeatures()
  const branding = systemFeatures?.branding
  const applicationTitle = getApplicationTitle(branding)
  const brandedFavicon = branding?.enabled ? branding.favicon : undefined

  return {
    title: {
      default: applicationTitle,
      template: `%s - ${applicationTitle}`,
    },
    icons: brandedFavicon
      ? { icon: brandedFavicon, apple: brandedFavicon }
      : { icon: `${basePath}/favicon.ico` },
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const datasetMap = getDatasetMap()
  const requestHeaders = await headers()
  const nonce = IS_PROD ? (requestHeaders.get('x-nonce') ?? undefined) : undefined
  const themeProviderProps: Omit<ThemeProviderProps, 'children'> = {
    attribute: 'data-theme',
    defaultTheme: 'system',
    enableSystem: true,
    disableTransitionOnChange: true,
  }
  if (nonce !== undefined) themeProviderProps.nonce = nonce

  // Proxy always overwrites this header. The terminal error document must not
  // depend on console bootstrap APIs or render application-specific providers.
  if (requestHeaders.get('x-dify-pathname') === APP_UNAVAILABLE_PATH) {
    const documentLocale = getBrowserLocale(
      new Negotiator({
        headers: { 'accept-language': requestHeaders.get('accept-language') ?? '' },
      }).languages(),
    )
    return (
      <html lang={documentLocale} className="h-full" suppressHydrationWarning>
        <body className="h-full bg-background-body" {...datasetMap}>
          <ThemeProvider {...themeProviderProps}>
            <NuqsAdapter>{children}</NuqsAdapter>
          </ThemeProvider>
        </body>
      </html>
    )
  }

  const [locale] = await Promise.all([getLocaleOnServer(), getOptionalSystemFeatures()])
  const dehydratedState = dehydrateSystemFeatures()

  return (
    <html lang={locale ?? 'en'} className="h-full" suppressHydrationWarning>
      <head>
        <ReactScanLoader />
      </head>
      <body className="h-full bg-background-body" {...datasetMap}>
        <CloudAnalytics />
        <div className="isolate h-full">
          <JotaiProvider>
            <ThemeProvider {...themeProviderProps}>
              <NuqsAdapter>
                <TanStackQueryProvider>
                  <HydrationBoundary state={dehydratedState}>
                    <I18nServerProvider>
                      <AppToastHost timeout={5000} limit={3} />
                      <SystemFeaturesBootstrapBoundary>
                        <PartnerStackCookieRecorder />
                        <TooltipProvider delay={300} closeDelay={200}>
                          <AppAccessBoundary>{children}</AppAccessBoundary>
                        </TooltipProvider>
                      </SystemFeaturesBootstrapBoundary>
                    </I18nServerProvider>
                  </HydrationBoundary>
                </TanStackQueryProvider>
              </NuqsAdapter>
            </ThemeProvider>
          </JotaiProvider>
          <AgentationLoader />
        </div>
      </body>
    </html>
  )
}
