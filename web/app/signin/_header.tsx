'use client'
import React from 'react'
import { useContext } from 'use-context-selector'
import Select from '@/app/components/base/select/locale'
import ThemeSelector from '@/app/components/base/theme-selector'
import Divider from '@/app/components/base/divider'
import { languages } from '@/i18n/language'
import type { Locale } from '@/i18n'
import I18n from '@/context/i18n'
import LogoSite from '@/app/components/base/logo/logo-site'

const Header = () => {
  const { locale, setLocaleOnClient } = useContext(I18n)

  return (
    <div className='flex w-full items-center justify-between p-6'>
      <LogoSite />
      <div className='flex items-center gap-1'>
        <Select
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
