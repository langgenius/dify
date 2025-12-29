'use client'

import type { FC } from 'react'
import type { Locale } from '@/i18n-config'
import { usePrefetchQuery } from '@tanstack/react-query'
import * as React from 'react'
import { useEffect, useState } from 'react'
import { useLocale } from '@/context/i18n'
import { setLocaleOnClient } from '@/i18n-config'
import { getSystemFeatures } from '@/service/common'
import Loading from './base/loading'

import '../../i18n-config/i18next-config'

export type II18nProps = {
  locale: Locale
  children: React.ReactNode
}
const I18n: FC<II18nProps> = ({
  children,
}) => {
  const [loading, setLoading] = useState(true)
  const locale = useLocale()

  usePrefetchQuery({
    queryKey: ['systemFeatures'],
    queryFn: getSystemFeatures,
  })

  useEffect(() => {
    console.log('Setting locale on client:', locale)
    setLocaleOnClient(locale, false).then(() => {
      setLoading(false)
    })
  }, [locale])

  if (loading)
    return <div className="flex h-screen w-screen items-center justify-center"><Loading type="app" /></div>

  return (
    <>
      {children}
    </>
  )
}
export default React.memo(I18n)
