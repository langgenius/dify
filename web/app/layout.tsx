import type { Viewport } from 'next'
import { Provider as JotaiProvider } from 'jotai'
import { ThemeProvider } from 'next-themes'
import { Instrument_Serif } from 'next/font/google'
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import GlobalPublicStoreProvider from '@/context/global-public-context'
import { TanstackQueryInitializer } from '@/context/query-client'
import { env } from '@/env'
import { getLocaleOnServer } from '@/i18n-config/server'
import { DatasetAttr } from '@/types/feature'
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

  const datasetMap: Record<DatasetAttr, string | undefined> = {
    [DatasetAttr.DATA_API_PREFIX]: env.NEXT_PUBLIC_API_PREFIX,
    [DatasetAttr.DATA_PUBLIC_API_PREFIX]: env.NEXT_PUBLIC_PUBLIC_API_PREFIX,
    [DatasetAttr.DATA_MARKETPLACE_API_PREFIX]: env.NEXT_PUBLIC_MARKETPLACE_API_PREFIX,
    [DatasetAttr.DATA_MARKETPLACE_URL_PREFIX]: env.NEXT_PUBLIC_MARKETPLACE_URL_PREFIX,
    [DatasetAttr.DATA_PUBLIC_EDITION]: env.NEXT_PUBLIC_EDITION,
    [DatasetAttr.DATA_PUBLIC_AMPLITUDE_API_KEY]: env.NEXT_PUBLIC_AMPLITUDE_API_KEY,
    [DatasetAttr.DATA_PUBLIC_COOKIE_DOMAIN]: env.NEXT_PUBLIC_COOKIE_DOMAIN,
    [DatasetAttr.DATA_PUBLIC_SUPPORT_MAIL_LOGIN]: env.NEXT_PUBLIC_SUPPORT_MAIL_LOGIN,
    [DatasetAttr.DATA_PUBLIC_SENTRY_DSN]: env.NEXT_PUBLIC_SENTRY_DSN,
    [DatasetAttr.DATA_PUBLIC_MAINTENANCE_NOTICE]: env.NEXT_PUBLIC_MAINTENANCE_NOTICE,
    [DatasetAttr.DATA_PUBLIC_SITE_ABOUT]: env.NEXT_PUBLIC_SITE_ABOUT,
    [DatasetAttr.DATA_PUBLIC_TEXT_GENERATION_TIMEOUT_MS]: env.NEXT_PUBLIC_TEXT_GENERATION_TIMEOUT_MS,
    [DatasetAttr.DATA_PUBLIC_MAX_TOOLS_NUM]: env.NEXT_PUBLIC_MAX_TOOLS_NUM,
    [DatasetAttr.DATA_PUBLIC_MAX_PARALLEL_LIMIT]: env.NEXT_PUBLIC_MAX_PARALLEL_LIMIT,
    [DatasetAttr.DATA_PUBLIC_TOP_K_MAX_VALUE]: env.NEXT_PUBLIC_TOP_K_MAX_VALUE,
    [DatasetAttr.DATA_PUBLIC_INDEXING_MAX_SEGMENTATION_TOKENS_LENGTH]: env.NEXT_PUBLIC_INDEXING_MAX_SEGMENTATION_TOKENS_LENGTH,
    [DatasetAttr.DATA_PUBLIC_LOOP_NODE_MAX_COUNT]: env.NEXT_PUBLIC_LOOP_NODE_MAX_COUNT,
    [DatasetAttr.DATA_PUBLIC_MAX_ITERATIONS_NUM]: env.NEXT_PUBLIC_MAX_ITERATIONS_NUM,
    [DatasetAttr.DATA_PUBLIC_MAX_TREE_DEPTH]: env.NEXT_PUBLIC_MAX_TREE_DEPTH,
    [DatasetAttr.DATA_PUBLIC_ALLOW_UNSAFE_DATA_SCHEME]: env.NEXT_PUBLIC_ALLOW_UNSAFE_DATA_SCHEME,
    [DatasetAttr.DATA_PUBLIC_ENABLE_WEBSITE_JINAREADER]: env.NEXT_PUBLIC_ENABLE_WEBSITE_JINAREADER,
    [DatasetAttr.DATA_PUBLIC_ENABLE_WEBSITE_FIRECRAWL]: env.NEXT_PUBLIC_ENABLE_WEBSITE_FIRECRAWL,
    [DatasetAttr.DATA_PUBLIC_ENABLE_WEBSITE_WATERCRAWL]: env.NEXT_PUBLIC_ENABLE_WEBSITE_WATERCRAWL,
    [DatasetAttr.DATA_PUBLIC_ENABLE_SINGLE_DOLLAR_LATEX]: env.NEXT_PUBLIC_ENABLE_SINGLE_DOLLAR_LATEX,
    [DatasetAttr.NEXT_PUBLIC_ZENDESK_WIDGET_KEY]: env.NEXT_PUBLIC_ZENDESK_WIDGET_KEY,
    [DatasetAttr.NEXT_PUBLIC_ZENDESK_FIELD_ID_ENVIRONMENT]: env.NEXT_PUBLIC_ZENDESK_FIELD_ID_ENVIRONMENT,
    [DatasetAttr.NEXT_PUBLIC_ZENDESK_FIELD_ID_VERSION]: env.NEXT_PUBLIC_ZENDESK_FIELD_ID_VERSION,
    [DatasetAttr.NEXT_PUBLIC_ZENDESK_FIELD_ID_EMAIL]: env.NEXT_PUBLIC_ZENDESK_FIELD_ID_EMAIL,
    [DatasetAttr.NEXT_PUBLIC_ZENDESK_FIELD_ID_WORKSPACE_ID]: env.NEXT_PUBLIC_ZENDESK_FIELD_ID_WORKSPACE_ID,
    [DatasetAttr.NEXT_PUBLIC_ZENDESK_FIELD_ID_PLAN]: env.NEXT_PUBLIC_ZENDESK_FIELD_ID_PLAN,
    [DatasetAttr.DATA_PUBLIC_BATCH_CONCURRENCY]: env.NEXT_PUBLIC_BATCH_CONCURRENCY,
  }

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
