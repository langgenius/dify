'use client'

import type { FC } from 'react'
import type { Locale } from '@/i18n-config'
import { usePrefetchQuery } from '@tanstack/react-query'
import { useHydrateAtoms } from 'jotai/utils'
import * as React from 'react'
import { useEffect, useState } from 'react'
import { localeAtom } from '@/context/i18n'
import { setLocaleOnClient } from '@/i18n-config'
import { getSystemFeatures } from '@/service/common'
import Loading from './base/loading'

export type II18nProps = {
  locale: Locale
  children: React.ReactNode
}
const I18n: FC<II18nProps> = ({
  locale,
  children,
}) => {
  useHydrateAtoms([[localeAtom, locale]])
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
    return <div className="flex h-screen w-screen items-center justify-center"><Loading type="app" /></div>

  return (
    <>
      {children}
    </>
  )
}
export default React.memo(I18n)
