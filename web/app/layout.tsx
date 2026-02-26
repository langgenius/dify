import type { Viewport } from 'next'
import { Provider as JotaiProvider } from 'jotai'
import { ThemeProvider } from 'next-themes'
import { Instrument_Serif } from 'next/font/google'
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import GlobalPublicStoreProvider from '@/context/global-public-context'
import { TanstackQueryInitializer } from '@/context/query-client'
import { getDatasetMap } from '@/env'
import { getLocaleOnServer } from '@/i18n-config/server'
import { cn } from '@/utils/classnames'
import { ToastProvider } from './components/base/toast'
import BrowserInitializer from './components/browser-initializer'
import { ReactScanLoader } from './components/devtools/react-scan/loader'
import { I18nServerProvider } from './components/provider/i18n-server'
import { PWAProvider } from './components/provider/serwist'
import SentryInitializer from './components/sentry-initializer'
import RoutePrefixHandle from './routePrefixHandle'
import './styles/globals.css'
import './styles/markdown.scss'

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  userScalable: false,
}

const instrumentSerif = Instrument_Serif({
  weight: ['400'],
  style: ['normal', 'italic'],
  subsets: ['latin'],
  variable: '--font-instrument-serif',
})

const LocaleLayout = async ({
  children,
}: {
  children: React.ReactNode
}) => {
  const locale = await getLocaleOnServer()
  const datasetMap = getDatasetMap()

  return (
    <html lang={locale ?? 'en'} className={cn('h-full', instrumentSerif.variable)} suppressHydrationWarning>
      <head>
        <link rel="manifest" href="/manifest.json" />
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
      </head>
      <body
        className="color-scheme h-full select-auto"
        {...datasetMap}
      >
        <PWAProvider>
          <ReactScanLoader />
          <JotaiProvider>
            <ThemeProvider
              attribute="data-theme"
              defaultTheme="system"
              enableSystem
              disableTransitionOnChange
              enableColorScheme={false}
            >
              <NuqsAdapter>
                <BrowserInitializer>
                  <SentryInitializer>
                    <TanstackQueryInitializer>
                      <I18nServerProvider>
                        <ToastProvider>
                          <GlobalPublicStoreProvider>
                            {children}
                          </GlobalPublicStoreProvider>
                        </ToastProvider>
                      </I18nServerProvider>
                    </TanstackQueryInitializer>
                  </SentryInitializer>
                </BrowserInitializer>
              </NuqsAdapter>
            </ThemeProvider>
          </JotaiProvider>
          <RoutePrefixHandle />
        </PWAProvider>
      </body>
    </html>
  )
}

export default LocaleLayout
