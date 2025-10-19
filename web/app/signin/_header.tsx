'use client'
import React from 'react'
import { useContext } from 'use-context-selector'
import LocaleSigninSelect from '@/app/components/base/select/locale-signin'
import Divider from '@/app/components/base/divider'
import { languages } from '@/i18n-config/language'
import type { Locale } from '@/i18n-config'
import I18n from '@/context/i18n'
import dynamic from 'next/dynamic'
import { useGlobalPublicStore } from '@/context/global-public-context'

// Avoid rendering the logo and theme selector on the server
const DifyLogo = dynamic(() => import('@/app/components/base/logo/dify-logo'), {
  ssr: false,
  loading: () => <div className='h-7 w-16 bg-transparent' />,
})
const ThemeSelector = dynamic(() => import('@/app/components/base/theme-selector'), {
  ssr: false,
  loading: () => <div className='size-8 bg-transparent' />,
})

const Header = () => {
  const { locale, setLocaleOnClient } = useContext(I18n)
  const systemFeatures = useGlobalPublicStore(s => s.systemFeatures)

  return (
    <div className='flex w-full items-center justify-between p-6'>
      {systemFeatures.branding.enabled && systemFeatures.branding.login_page_logo
        ? <img
          src={systemFeatures.branding.login_page_logo}
          className='block h-7 w-auto object-contain'
          alt='logo'
        />
        : <DifyLogo size='large' />}
      <div className='flex items-center gap-1'>
        <LocaleSigninSelect
          value={locale}
          items={languages.filter(item => item.supported)}
          onChange={(value) => {
            setLocaleOnClient(value as Locale)
          }}
        />
        <Divider type='vertical' className='mx-0 ml-2 h-4' />
        <ThemeSelector />
      </div>
    </div>
  )
}

export default Header
