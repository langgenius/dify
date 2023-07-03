import I18nServer from './components/i18n-server'
import SentryInitor from './components/sentry-initor'
import { getLocaleOnServer } from '@/i18n/server'

import './styles/globals.css'
import './styles/markdown.scss'

export const metadata = {
  title: 'Dify',
}

const LocaleLayout = ({
  children,
}: {
  children: React.ReactNode
}) => {
  const locale = getLocaleOnServer()

  return (
    <html lang={locale ?? 'en'} className="h-full">
      <body
        className="h-full"
        data-api-prefix={process.env.NEXT_PUBLIC_API_PREFIX}
        data-pubic-api-prefix={process.env.NEXT_PUBLIC_PUBLIC_API_PREFIX}
        data-public-edition={process.env.NEXT_PUBLIC_EDITION}
        data-public-sentry-dsn={process.env.NEXT_PUBLIC_SENTRY_DSN}
      >
        <SentryInitor>
          {/* @ts-expect-error Async Server Component */}
          <I18nServer locale={locale}>{children}</I18nServer>
        </SentryInitor>
      </body>
    </html>
  )
}

export default LocaleLayout
