'use client'
import { useSuspenseQuery } from '@tanstack/react-query'
import Divider from '@/app/components/base/divider'
import { useLocale } from '@/context/i18n'
import { setLocaleOnClient } from '@/i18n-config'
import { languages } from '@/i18n-config/language'
import dynamic from '@/next/dynamic'
import { systemFeaturesQueryOptions } from '@/service/system-features'
import LocaleMenu from './_locale-menu'

// Avoid rendering the logo and theme selector on the server
const DifyLogo = dynamic(() => import('@/app/components/base/logo/dify-logo'), {
  ssr: false,
  loading: () => <div className="h-7 w-16 bg-transparent" />,
})
const ThemeSelector = dynamic(() => import('@/app/components/base/theme-selector'), {
  ssr: false,
  loading: () => <div className="size-8 bg-transparent" />,
})

const Header = () => {
  const locale = useLocale()
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())

  return (
    <div className="flex w-full items-center justify-between p-6">
      {systemFeatures.branding.enabled && systemFeatures.branding.login_page_logo
        ? (
            <img
              src={systemFeatures.branding.login_page_logo}
              className="block h-7 w-auto object-contain"
              alt="logo"
            />
          )
        : <DifyLogo size="large" />}
      <div className="flex items-center gap-1">
        <LocaleMenu
          value={locale}
          items={languages.filter(item => item.supported)}
          onChange={(value) => {
            setLocaleOnClient(value, false)
          }}
        />
        <Divider type="vertical" className="mx-0 ml-2 h-4" />
        <ThemeSelector />
      </div>
    </div>
  )
}

export default Header
