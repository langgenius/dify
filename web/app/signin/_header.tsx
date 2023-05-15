'use client'
import React from 'react'
import style from './page.module.css'
import Select, { LOCALES } from '@/app/components/base/select/locale'
import { type Locale } from '@/i18n'
import I18n from '@/context/i18n'
import { setLocaleOnClient } from '@/i18n/client'
import { useContext } from 'use-context-selector'


type IHeaderProps = {
  locale: string
}

const Header = () => {
  const { locale, setLocaleOnClient } = useContext(I18n)
  return <div className='flex items-center justify-between p-6 w-full'>
    <div className={style.logo}></div>
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
