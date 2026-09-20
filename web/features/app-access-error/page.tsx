'use client'

import type { Locale } from '@/i18n-config'
import { cn } from '@langgenius/dify-ui/cn'
import { createInstance } from 'i18next'
import resourcesToBackend from 'i18next-resources-to-backend'
import { Suspense, useEffect, useState } from 'react'
import { I18nextProvider, Trans, useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { DifyLogo } from '@/app/components/base/logo/dify-logo'
import ThemeSelector from '@/app/components/base/theme-selector'
import { loadI18nResource } from '@/i18n-config/load-resource'
import { getInitOptions } from '@/i18n-config/settings'
import { basePath } from '@/utils/var'
import { getBrowserLocale } from './locale'
import LocaleMenu from './locale-menu'
import { getClientIp } from './state'

type AppNotAccessibleProps = {
  clientIp?: string
  /** A dialog supplies its own landmarks and close control. */
  embedded?: boolean
}

function PageContent({ clientIp, embedded }: AppNotAccessibleProps) {
  const { t, i18n } = useTranslation('share')
  const [copyrightYear] = useState(() => new Date().getFullYear())
  const title = t(($) => $['appNotAccessible.documentTitle'])
  const ip = getClientIp({ client_ip: clientIp })
  const Content = embedded ? 'div' : 'main'

  useEffect(() => {
    const previous = document.title
    document.title = title
    return () => {
      document.title = previous
    }
  }, [title])

  return (
    <div
      lang={i18n.language}
      dir={i18n.dir()}
      className={cn(
        'w-full overflow-y-auto bg-background-default-burn p-1',
        embedded ? 'min-h-full' : 'h-dvh',
      )}
    >
      <div className="flex min-h-full min-w-0 flex-col rounded-lg border border-effects-highlight bg-background-default-subtle">
        <header className="flex shrink-0 items-center justify-between gap-2 pt-4 pr-3 pb-3 pl-6">
          <DifyLogo alt="Dify" size="large" className="w-15.75 shrink-0" />
          <div className="flex min-w-0 items-center gap-2">
            <LocaleMenu
              locale={i18n.language as Locale}
              onChange={(value) => {
                void i18n.changeLanguage(value)
              }}
            />
            <ThemeSelector />
          </div>
        </header>
        <Content className="flex flex-1 items-center justify-center px-6 pt-12 pb-12 md:pb-30">
          <div className="flex w-full max-w-120 flex-col items-start">
            <img
              src={`${basePath}/illustrations/app-not-accessible.png`}
              width={184}
              height={184}
              alt=""
              className="mb-6 size-46 max-w-full object-contain"
            />
            <h1 className="text-base leading-[1.2] font-semibold wrap-break-word text-text-primary">
              {t(($) => $['appNotAccessible.title'])}
            </h1>
            <p className="mt-2 system-sm-regular text-text-primary">
              {t(($) => $['appNotAccessible.description'])}
            </p>
            {ip && (
              <p className="mt-8 max-w-full system-sm-regular text-text-primary">
                <Trans
                  t={t}
                  i18nKey={($) => $['appNotAccessible.ipAddress']}
                  values={{ ip }}
                  components={{
                    ip: (
                      <code
                        dir="ltr"
                        className="rounded bg-background-default-burn px-1 font-mono code-sm-semibold tracking-[0.065px] break-all"
                      />
                    ),
                  }}
                />
              </p>
            )}
          </div>
        </Content>
        <footer className="shrink-0 px-6 pt-2 pb-6 text-center system-xs-regular text-text-tertiary">
          © {copyrightYear} LangGenius, Inc. All rights reserved.
        </footer>
      </div>
    </div>
  )
}

export default function AppNotAccessible(props: AppNotAccessibleProps) {
  const [i18n] = useState(() => {
    // A private instance keeps browser-language selection and menu changes off the console cookie.
    const instance = createInstance()
    void instance.use(resourcesToBackend(loadI18nResource)).init({
      ...getInitOptions(),
      lng: getBrowserLocale(typeof navigator === 'undefined' ? [] : navigator.languages),
      ns: ['share', 'common'],
      defaultNS: 'share',
    })
    return instance
  })
  return (
    <Suspense fallback={<Loading type="app" />}>
      <I18nextProvider i18n={i18n}>
        <PageContent {...props} />
      </I18nextProvider>
    </Suspense>
  )
}
