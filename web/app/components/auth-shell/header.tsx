'use client'
import { Separator } from '@langgenius/dify-ui/separator'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useLocale } from '#i18n'
import { DifyLogo } from '@/app/components/base/logo/dify-logo'
import ThemeSelector from '@/app/components/base/theme-selector'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { setLocaleOnClient } from '@/i18n/client'
import { languages } from '@/i18n/language'
import { useRouter } from '@/next/navigation'
import LocaleMenu from './locale-menu'

const Header = () => {
  const locale = useLocale()
  const router = useRouter()
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())

  return (
    <header className="flex w-full items-center justify-between gap-3 p-4 sm:p-6">
      {systemFeatures.branding.enabled && systemFeatures.branding.login_page_logo ? (
        <img
          src={systemFeatures.branding.login_page_logo}
          className="block h-7 w-auto object-contain"
          alt={systemFeatures.branding.application_title || ''}
        />
      ) : (
        <DifyLogo alt="Dify" size="large" />
      )}
      <div className="flex min-w-0 items-center gap-1">
        <LocaleMenu
          value={locale}
          items={languages.filter((item) => item.supported)}
          onChange={async (value) => {
            await setLocaleOnClient(value)
            router.refresh()
          }}
        />
        <div className="flex shrink-0 items-center gap-1">
          <Separator decorative orientation="vertical" className="mx-0 ms-2 h-4" />
          <ThemeSelector />
        </div>
      </div>
    </header>
  )
}

export default Header
