'use client'

import type { FC } from 'react'
import React, { useEffect, useState } from 'react'
import I18NContext from '@/context/i18n'
import type { Locale } from '@/i18n-config'
import { setLocaleOnClient } from '@/i18n-config'
import Loading from './base/loading'
import { usePrefetchQuery } from '@tanstack/react-query'
import { getSystemFeatures } from '@/service/common'

export type II18nProps = {
  locale: Locale
  children: React.ReactNode
}
const I18n: FC<II18nProps> = ({
  locale,
  children,
}) => {
  const [loading, setLoading] = useState(true)

  usePrefetchQuery({
    queryKey: ['systemFeatures'],
    queryFn: getSystemFeatures,
  })

  useEffect(() => {
    setLocaleOnClient(locale, false).then(() => {
      setLoading(false)
    })
  }, [locale])

  if (loading)
    return <div className='flex h-screen w-screen items-center justify-center'><Loading type='app' /></div>

  return (
    <I18NContext.Provider value={{
      locale,
      i18n: {},
      setLocaleOnClient,
    }}>
      {children}
    </I18NContext.Provider>
  )
}
export default React.memo(I18n)
