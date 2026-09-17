'use client'

import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { DifyLogo } from '@/app/components/base/logo/dify-logo'
import { basePath } from '@/utils/var'
import LocaleMenu from './locale-menu'

type AccessRestrictedProps = {
  clientIp?: string
}

export default function AccessRestricted({ clientIp }: AccessRestrictedProps) {
  const { t } = useTranslation('share')
  const [copyrightYear] = useState(() => new Date().getFullYear())

  return (
    <div className="flex min-h-dvh w-full bg-background-default-burn p-6">
      <div className="flex min-w-0 flex-1 flex-col rounded-2xl border border-effects-highlight bg-background-default-subtle">
        <header className="flex items-center justify-between gap-4 p-6">
          <DifyLogo alt="Dify" size="large" className="w-15.75 shrink-0" />
          <LocaleMenu />
        </header>
        <main className="flex flex-1 flex-col items-center px-6 pt-12 pb-6 md:pt-40">
          <div className="flex w-full max-w-120 flex-col gap-6">
            <div className="relative isolate aspect-12/7 overflow-hidden rounded-lg">
              <img
                src={`${basePath}/illustrations/ip-access-denied.png`}
                width={480}
                height={280}
                alt=""
                className="size-full object-cover"
              />
              <div className="absolute inset-0 bg-[#0033ff] mix-blend-plus-lighter" />
            </div>
            <div className="flex flex-col gap-3">
              <h1 className="text-base leading-[1.2] font-semibold text-text-primary">
                {t(($) => $['ipAccessDenied.title'])}
              </h1>
              <div className="flex flex-col gap-1.5 system-sm-regular text-text-primary">
                <p>{t(($) => $['ipAccessDenied.description'])}</p>
                {clientIp && (
                  <p>
                    <Trans
                      i18nKey={($) => $['ipAccessDenied.ipAddress']}
                      ns="share"
                      values={{ ip: clientIp }}
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
            </div>
          </div>
        </main>
        <footer className="px-6 py-6 text-center system-xs-regular text-text-tertiary">
          © {copyrightYear} LangGenius, Inc. All rights reserved.
        </footer>
      </div>
    </div>
  )
}
