'use client'
import { buttonVariants } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { DifyLogo } from '@/app/components/base/logo/dify-logo'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import Link from '@/next/link'
import Avatar from './avatar'

const Header = () => {
  const { t } = useTranslation()
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const logoLabel =
    systemFeatures.branding.enabled && systemFeatures.branding.application_title
      ? systemFeatures.branding.application_title
      : 'Dify'

  return (
    <div className="flex flex-1 items-center justify-between px-4">
      <div className="flex items-center gap-3">
        <Link
          href="/apps"
          className="flex items-center rounded-sm hover:opacity-80 focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
          aria-label={logoLabel}
        >
          {systemFeatures.branding.enabled && systemFeatures.branding.login_page_logo ? (
            <img
              src={systemFeatures.branding.login_page_logo}
              className="block h-5.5 w-auto object-contain"
              alt=""
            />
          ) : (
            <DifyLogo alt="" />
          )}
        </Link>
        <div className="h-4 w-px origin-center rotate-[11.31deg] bg-divider-regular" />
        <p className="relative -mt-0.5 title-3xl-semi-bold text-text-primary">
          {t(($) => $['account.account'], { ns: 'common' })}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <Link href="/" className={cn(buttonVariants(), 'px-3 py-2 system-sm-medium')}>
          <span aria-hidden className="i-custom-vender-main-nav-home size-4" />
          <p>{t(($) => $['mainNav.home'], { ns: 'common' })}</p>
          <span aria-hidden className="i-ri-arrow-right-up-line size-4" />
        </Link>
        <div className="h-4 w-px bg-divider-regular" />
        <Avatar />
      </div>
    </div>
  )
}
export default Header
