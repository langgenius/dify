import type { Viewport } from '@/next'
import { ToastHost } from '@langgenius/dify-ui/toast'
import { TooltipProvider } from '@langgenius/dify-ui/tooltip'
import { Provider as JotaiProvider } from 'jotai/react'
import { ThemeProvider } from 'next-themes'
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import { IS_PROD } from '@/config'
import { TanstackQueryInitializer } from '@/context/query-client'
import { getDatasetMap } from '@/env'
import { getLocaleOnServer } from '@/i18n-config/server'
import { headers } from '@/next/headers'
import { CloudAnalyticsBoundary } from './components/base/analytics-consent/cloud-analytics-boundary'
import { CloudAnalyticsRuntime } from './components/base/analytics-consent/cloud-analytics-runtime'
import { getCloudAnalyticsBoundaryState } from './components/base/analytics-consent/cloud-analytics-state'
import PartnerStackCookieRecorder from './components/billing/partner-stack/cookie-recorder'
import { AgentationLoader } from './components/devtools/agentation-loader'
import { ReactScanLoader } from './components/devtools/react-scan/loader'
import ExternalAttributionRecorder from './components/external-attribution-recorder'
import { I18nServerProvider } from './components/provider/i18n-server'
import RoutePrefixHandle from './routePrefixHandle'
import './styles/globals.css'
import './styles/markdown.css'

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

const resizeObserverErrorFilterScript = `
(() => {
  const ignoredMessages = new Set([
    'ResizeObserver loop completed with undelivered notifications.',
    'ResizeObserver loop limit exceeded',
  ]);
  const ignore = (event) => {
    const message = event?.message || event?.reason?.message;
    if (!ignoredMessages.has(message)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  window.addEventListener('error', ignore, true);
  window.addEventListener('unhandledrejection', ignore, true);
})();
`

const LocaleLayout = async ({ children }: { children: React.ReactNode }) => {
  const locale = await getLocaleOnServer()
  const datasetMap = getDatasetMap()
  const requestHeaders = await headers()
  const nonce = IS_PROD ? (requestHeaders.get('x-nonce') ?? undefined) : undefined
  const cloudAnalyticsState = getCloudAnalyticsBoundaryState(requestHeaders)

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

        <CloudAnalyticsBoundary {...cloudAnalyticsState} />
        <ReactScanLoader />
      </head>
      <body className="h-full bg-background-body" {...datasetMap}>
        {cloudAnalyticsState.enabled && <CloudAnalyticsRuntime />}
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
                <TanstackQueryInitializer>
                  <I18nServerProvider>
                    <ToastHost timeout={5000} limit={3} />
                    <PartnerStackCookieRecorder />
                    <ExternalAttributionRecorder />
                    <TooltipProvider delay={300} closeDelay={200}>
                      {children}
                    </TooltipProvider>
                  </I18nServerProvider>
                </TanstackQueryInitializer>
              </NuqsAdapter>
            </ThemeProvider>
          </JotaiProvider>
          <RoutePrefixHandle />
          <AgentationLoader />
        </div>
      </body>
    </html>
  )
}

export default LocaleLayout
