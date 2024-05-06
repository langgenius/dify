import type { Viewport } from 'next'
import I18nServer from './components/i18n-server'
import BrowerInitor from './components/browser-initor'
import SentryInitor from './components/sentry-initor'
import Topbar from './components/base/topbar'
import { getLocaleOnServer } from '@/i18n/server'
import './styles/globals.css'
import './styles/markdown.scss'
import { env } from '@/env'

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

const LocaleLayout = ({
  children,
}: {
  children: React.ReactNode
}) => {
  const locale = getLocaleOnServer()

  return (
    <html lang={locale ?? 'en'} className="h-full">
      <head>
        <meta name="theme-color" content="#FFFFFF" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
      </head>
      <body
        className="h-full select-auto"
        data-public-maintenance-notice={env.NEXT_PUBLIC_MAINTENANCE_NOTICE}
        data-public-site-about={env.NEXT_PUBLIC_SITE_ABOUT}
      >
        <Topbar/>
        <BrowerInitor>
          <SentryInitor>
            {/* @ts-expect-error Async Server Component */}
            <I18nServer locale={locale}>{children}</I18nServer>
          </SentryInitor>
        </BrowerInitor>
      </body>
    </html>
  )
}

export default LocaleLayout
