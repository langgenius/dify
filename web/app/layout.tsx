import type { Viewport } from '@/next'
import { ToastHost } from '@langgenius/dify-ui/toast'
import { TooltipProvider } from '@langgenius/dify-ui/tooltip'
import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import { Provider as JotaiProvider } from 'jotai/react'
import { ThemeProvider } from 'next-themes'
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import { IS_PROD } from '@/config'
import { getDatasetMap } from '@/env'
import { SystemFeaturesBootstrapBoundary } from '@/features/system-features/bootstrap-boundary'
import {
  getSystemFeaturesQueryClient,
  systemFeaturesServerQueryOptions,
} from '@/features/system-features/server'
import { getLocaleOnServer } from '@/i18n-config/server'
import { headers } from '@/next/headers'
import { CloudAnalytics } from './components/base/analytics-consent/cloud-analytics'
import { PartnerStackCookieRecorder } from './components/billing/partner-stack/cookie-recorder'
import { AgentationLoader } from './components/devtools/agentation-loader'
import { ReactScanLoader } from './components/devtools/react-scan/loader'
import { I18nServerProvider } from './components/provider/i18n-server'
import { TanStackQueryProvider } from './query-provider'
import './styles/globals.css'
import './styles/markdown.css'

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const datasetMap = getDatasetMap()
  const queryClient = getSystemFeaturesQueryClient()
  const systemFeaturesQuery = systemFeaturesServerQueryOptions()
  const [locale, requestHeaders] = await Promise.all([
    getLocaleOnServer(),
    headers(),
    queryClient.prefetchQuery(systemFeaturesQuery),
  ])
  const dehydratedState = dehydrate(queryClient)
  const nonce = IS_PROD ? (requestHeaders.get('x-nonce') ?? undefined) : undefined

  return (
    <html lang={locale ?? 'en'} className="h-full" suppressHydrationWarning>
      <head>
        <link rel="manifest" href="/manifest.json" />
        <script
          nonce={nonce}
          // oxlint-disable-next-line eslint-react/dom-no-dangerously-set-innerhtml -- Static early listener must run before the dev error overlay registers.
          dangerouslySetInnerHTML={{ __html: resizeObserverErrorFilterScript }}
        />
        <meta name="theme-color" content="#1C64F2" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="Dify" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="icon" type="image/png" sizes="32x32" href="/icon-192x192.png" />
        <link rel="icon" type="image/png" sizes="16x16" href="/icon-192x192.png" />
        <meta name="msapplication-TileColor" content="#1C64F2" />
        <meta name="msapplication-config" content="/browserconfig.xml" />

        <ReactScanLoader />
      </head>
      <body className="h-full bg-background-body" {...datasetMap}>
        <CloudAnalytics />
        <div className="isolate h-full">
          <JotaiProvider>
            <ThemeProvider
              attribute="data-theme"
              defaultTheme="system"
              enableSystem
              disableTransitionOnChange
              nonce={nonce}
            >
              <NuqsAdapter>
                <TanStackQueryProvider>
                  <HydrationBoundary state={dehydratedState}>
                    <I18nServerProvider>
                      <ToastHost timeout={5000} limit={3} />
                      <SystemFeaturesBootstrapBoundary>
                        <PartnerStackCookieRecorder />
                        <TooltipProvider delay={300} closeDelay={200}>
                          {children}
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
