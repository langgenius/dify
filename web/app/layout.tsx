import type { Viewport } from 'next'
import RoutePrefixHandle from './routePrefixHandle'
import I18nServer from './components/i18n-server'
import BrowserInitor from './components/browser-initor'
import SentryInitor from './components/sentry-initor'
import { getLocaleOnServer } from '@/i18n/server'
import { TanstackQueryIniter } from '@/context/query-client'
import { ThemeProvider } from 'next-themes'
import './styles/globals.css'
import './styles/markdown.scss'

export const metadata = {
  title: 'Dify',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  userScalable: false,
}

const LocaleLayout = async ({
  children,
}: {
  children: React.ReactNode
}) => {
  const locale = await getLocaleOnServer()

  return (
    <html lang={locale ?? 'en'} className="h-full" suppressHydrationWarning>
      <head>
        <meta name="theme-color" content="#FFFFFF" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
      </head>
      <body
        className="color-scheme h-full select-auto"
        data-api-prefix={process.env.NEXT_PUBLIC_API_PREFIX}
        data-pubic-api-prefix={process.env.NEXT_PUBLIC_PUBLIC_API_PREFIX}
        data-marketplace-api-prefix={process.env.NEXT_PUBLIC_MARKETPLACE_API_PREFIX}
        data-marketplace-url-prefix={process.env.NEXT_PUBLIC_MARKETPLACE_URL_PREFIX}
        data-public-edition={process.env.NEXT_PUBLIC_EDITION}
        data-public-support-mail-login={process.env.NEXT_PUBLIC_SUPPORT_MAIL_LOGIN}
        data-public-sentry-dsn={process.env.NEXT_PUBLIC_SENTRY_DSN}
        data-public-maintenance-notice={process.env.NEXT_PUBLIC_MAINTENANCE_NOTICE}
        data-public-site-about={process.env.NEXT_PUBLIC_SITE_ABOUT}
        data-public-text-generation-timeout-ms={process.env.NEXT_PUBLIC_TEXT_GENERATION_TIMEOUT_MS}
        data-public-max-tools-num={process.env.NEXT_PUBLIC_MAX_TOOLS_NUM}
        data-public-max-parallel-limit={process.env.NEXT_PUBLIC_MAX_PARALLEL_LIMIT}
        data-public-top-k-max-value={process.env.NEXT_PUBLIC_TOP_K_MAX_VALUE}
        data-public-indexing-max-segmentation-tokens-length={process.env.NEXT_PUBLIC_INDEXING_MAX_SEGMENTATION_TOKENS_LENGTH}
        data-public-loop-node-max-count={process.env.NEXT_PUBLIC_LOOP_NODE_MAX_COUNT}
        data-public-max-iterations-num={process.env.NEXT_PUBLIC_MAX_ITERATIONS_NUM}
        data-public-enable-website-jinareader={process.env.NEXT_PUBLIC_ENABLE_WEBSITE_JINAREADER}
        data-public-enable-website-firecrawl={process.env.NEXT_PUBLIC_ENABLE_WEBSITE_FIRECRAWL}
        data-public-enable-website-watercrawl={process.env.NEXT_PUBLIC_ENABLE_WEBSITE_WATERCRAWL}
      >
        <BrowserInitor>
          <SentryInitor>
            <TanstackQueryIniter>
              <ThemeProvider
                attribute='data-theme'
                forcedTheme='light'
                defaultTheme='light' // TODO: change to 'system' when dark mode ready
                enableSystem
                disableTransitionOnChange
              >
                <I18nServer>
                  {children}
                </I18nServer>
              </ThemeProvider>
            </TanstackQueryIniter>
          </SentryInitor>
        </BrowserInitor>
        <RoutePrefixHandle />
      </body>
    </html>
  )
}

export default LocaleLayout
