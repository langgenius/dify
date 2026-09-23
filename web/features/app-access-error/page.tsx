'use client'

import type { Resource } from 'i18next'
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
import { usePathname, useSearchParams } from '@/next/navigation'
import { basePath } from '@/utils/var'
import { getBrowserLocale } from './locale'
import LocaleMenu from './locale-menu'
import { getClientIp } from './state'

type AppNotAccessibleProps = {
  clientIp?: string
  /** A dialog supplies its own landmarks and close control. */
  embedded?: boolean
  /** The document gate supplies browser-language resources before streaming. */
  initialLocale?: Locale
  initialResources?: Resource
}

function PageContent({ clientIp, embedded }: AppNotAccessibleProps) {
  const { t, i18n } = useTranslation(['share', 'login'])
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const query = searchParams.toString()
  const returnTo = `${pathname}${query ? `?${query}` : ''}`
  const signInHref = `${basePath}/signin?${new URLSearchParams({ redirect_url: returnTo })}`
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
          <div className="flex min-w-0 items-center gap-1">
            <LocaleMenu
              locale={i18n.language as Locale}
              onChange={(value) => {
                void i18n.changeLanguage(value)
              }}
            />
            <ThemeSelector />
            <span aria-hidden className="h-3.5 w-px shrink-0 bg-divider-regular" />
            <a
              href={signInHref}
              className="inline-flex shrink-0 items-center rounded-full p-0.5 text-components-button-secondary-text hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
            >
              <span
                aria-hidden
                className="relative size-6 shrink-0 overflow-hidden rounded-full border-[0.5px] border-divider-regular bg-util-colors-gray-gray-300"
              >
                <img
                  src={`${basePath}/illustrations/sign-in-avatar-person.svg`}
                  width={18}
                  height={29.1429}
                  alt=""
                  className="absolute top-[21.43%] left-[12.5%] w-3/4 max-w-none"
                />
              </span>
              <span className="px-2 system-sm-medium whitespace-nowrap">
                {t(($) => $.signBtn, { ns: 'login' })}
              </span>
            </a>
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
      lng:
        props.initialLocale ??
        getBrowserLocale(typeof navigator === 'undefined' ? [] : navigator.languages),
      resources: props.initialResources,
      ns: ['share', 'common', 'login'],
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
