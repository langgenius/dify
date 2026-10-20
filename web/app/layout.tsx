import type { ThemeProviderProps } from 'next-themes'
import type { Metadata, Viewport } from '@/next'
import { TooltipProvider } from '@langgenius/dify-ui/tooltip'
import { HydrationBoundary } from '@tanstack/react-query'
import { Provider as JotaiProvider } from 'jotai/react'
import { ThemeProvider } from 'next-themes'
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import { AppToastHost } from '@/app/notifications/host'
import { IS_PROD } from '@/config'
import { getDatasetMap } from '@/env'
import AppAccessBoundary from '@/features/app-access-error/boundary'
import { getAppAccessErrorDocument } from '@/features/app-access-error/document'
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
  if (getAppAccessErrorDocument(await headers()))
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

  const errorDocument = getAppAccessErrorDocument(requestHeaders)
  const [locale] = errorDocument
    ? [errorDocument.locale]
    : await Promise.all([getLocaleOnServer(), getOptionalSystemFeatures()])
  const dehydratedState = errorDocument ? undefined : dehydrateSystemFeatures()

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>{!errorDocument && <ReactScanLoader />}</head>
      <body className="bg-background-body" {...datasetMap}>
        {!errorDocument && <CloudAnalytics />}
        <div className="isolate">
          <JotaiProvider>
            <ThemeProvider {...themeProviderProps}>
              <NuqsAdapter>
                {errorDocument ? (
                  children
                ) : (
                  <TanStackQueryProvider>
                    <HydrationBoundary state={dehydratedState}>
                      <I18nServerProvider>
                        <AppToastHost timeout={5000} limit={3} />
                        <SystemFeaturesBootstrapBoundary>
                          <TooltipProvider delay={300} closeDelay={200}>
                            <AppAccessBoundary>{children}</AppAccessBoundary>
                          </TooltipProvider>
                        </SystemFeaturesBootstrapBoundary>
                      </I18nServerProvider>
                    </HydrationBoundary>
                  </TanStackQueryProvider>
                )}
              </NuqsAdapter>
            </ThemeProvider>
          </JotaiProvider>
          {!errorDocument && <AgentationLoader />}
        </div>
      </body>
    </html>
  )
}
