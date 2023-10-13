'use client'
import React from 'react'
import { useContext } from 'use-context-selector'
import Image from 'next/image'
import logoUrl from '../../public/logo/logo-site.png'
import Select, { LOCALES } from '@/app/components/base/select/locale'
import { type Locale } from '@/i18n'
import I18n from '@/context/i18n'

const Header = () => {
  const { locale, setLocaleOnClient } = useContext(I18n)

  if (localStorage?.getItem('console_token'))
    localStorage.removeItem('console_token')

  return <div className='flex items-center justify-between p-6 w-full'>
    <Image alt='logo' src={logoUrl} className='w-auto h-10' />
    <Select
      value={locale}
      items={LOCALES}
      onChange={(value) => {
        setLocaleOnClient(value as Locale)
      }}
    />

  </div>
}

export default Header
