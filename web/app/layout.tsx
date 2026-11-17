import type { Metadata, Viewport } from '@/next'
import { TooltipProvider } from '@langgenius/dify-ui/tooltip'
import { HydrationBoundary } from '@tanstack/react-query'
import { dir } from 'i18next'
import { Provider as JotaiProvider } from 'jotai/react'
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import { AppToaster } from '@/app/notifications/app-toaster'
import { IS_PROD } from '@/config'
import { getDatasetMap } from '@/env'
import AppAccessBoundary from '@/features/app-access-error/boundary'
import { getAppAccessErrorDocument } from '@/features/app-access-error/document'
import { GENERATIVE_UI_PRESENTATION_PATH } from '@/features/generative-ui-presentation/route'
import { SystemFeaturesBootstrapBoundary } from '@/features/system-features/bootstrap-boundary'
import {
  dehydrateSystemFeatures,
  getOptionalSystemFeatures,
} from '@/features/system-features/server'
import { ThemeProvider } from '@/features/theme/provider'
import { getLocaleOnServer } from '@/i18n/server'
import { headers } from '@/next/headers'
import { getApplicationTitle } from '@/utils/document-title'
import { basePath } from '@/utils/var'
import { CloudAnalytics } from './components/base/analytics-consent/cloud-analytics'
import { AgentationLoader } from './components/devtools/agentation-loader'
import { ReactScanLoader } from './components/devtools/react-scan/loader'
import { I18nServerProvider } from './components/provider/i18n-server'
import { TanStackQueryProvider } from './query-provider'
import { QueryStateProvider } from './query-state-provider'
import '@/service/console/server'
import './styles/globals.css'
import './styles/markdown.css'

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers()
  if (
    getAppAccessErrorDocument(requestHeaders) ||
    requestHeaders.get('x-dify-pathname') === GENERATIVE_UI_PRESENTATION_PATH
  )
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

  const errorDocument = getAppAccessErrorDocument(requestHeaders)
  const isPresentation = requestHeaders.get('x-dify-pathname') === GENERATIVE_UI_PRESENTATION_PATH
  const needsConsoleBootstrap = !errorDocument && !isPresentation
  const [locale] = needsConsoleBootstrap
    ? await Promise.all([getLocaleOnServer(), getOptionalSystemFeatures()])
    : [errorDocument?.locale ?? (await getLocaleOnServer())]
  const dehydratedState = needsConsoleBootstrap ? dehydrateSystemFeatures() : undefined

  return (
    <html lang={locale} dir={dir(locale)} {...datasetMap} suppressHydrationWarning>
      <head>{needsConsoleBootstrap && <ReactScanLoader />}</head>
      <body className="bg-background-body">
        {needsConsoleBootstrap && <CloudAnalytics />}
        <div className="isolate">
          <JotaiProvider>
            <ThemeProvider nonce={nonce}>
              <NuqsAdapter>
                {!needsConsoleBootstrap ? (
                  children
                ) : (
                  <QueryStateProvider>
                    <TanStackQueryProvider>
                      <HydrationBoundary state={dehydratedState}>
                        <I18nServerProvider>
                          <AppToaster timeout={5000} limit={3} />
                          <SystemFeaturesBootstrapBoundary>
                            <TooltipProvider delay={300} closeDelay={200}>
                              <AppAccessBoundary>{children}</AppAccessBoundary>
                            </TooltipProvider>
                          </SystemFeaturesBootstrapBoundary>
                        </I18nServerProvider>
                      </HydrationBoundary>
                    </TanStackQueryProvider>
                  </QueryStateProvider>
                )}
              </NuqsAdapter>
            </ThemeProvider>
          </JotaiProvider>
          {needsConsoleBootstrap && <AgentationLoader />}
        </div>
      </body>
    </html>
  )
}
