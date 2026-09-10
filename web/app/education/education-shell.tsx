'use client'

import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { DifyLogo } from '@/app/components/base/logo/dify-logo'
import useDocumentTitle from '@/hooks/use-document-title'

type EducationShellProps = {
  children: ReactNode
}

export default function EducationShell({ children }: EducationShellProps) {
  const { t } = useTranslation()
  const pageTitle = t(($) => $.toVerified, { ns: 'education' })
  useDocumentTitle(pageTitle)

  return (
    <main className="h-full overflow-y-auto bg-background-body p-6">
      <div className="mx-auto w-full max-w-352 rounded-2xl border border-effects-highlight bg-background-default-subtle">
        <div
          className="h-87.25 w-full overflow-hidden rounded-t-2xl bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: 'url(/education/bg.png)' }}
          aria-hidden="true"
        />
        <div className="-mt-87.25 box-content flex h-7 items-center p-6">
          <DifyLogo alt="Dify" size="large" className="brightness-0 invert" />
        </div>
        <section className="mx-auto max-w-180 px-8 pb-45" aria-labelledby="education-page-title">
          <header className="mb-2 flex h-48 flex-col justify-end pt-3 pb-4 text-text-primary-on-surface">
            <h1 id="education-page-title" className="mb-2 title-5xl-bold shadow-xs">
              {pageTitle}
            </h1>
            <div className="system-md-medium shadow-xs">
              {t(($) => $['toVerifiedTip.front'], { ns: 'education' })}
              &nbsp;
              <span className="system-md-semibold underline">
                {t(($) => $['toVerifiedTip.coupon'], { ns: 'education' })}
              </span>
              &nbsp;
              {t(($) => $['toVerifiedTip.end'], { ns: 'education' })}
            </div>
          </header>
          {children}
        </section>
      </div>
    </main>
  )
}
