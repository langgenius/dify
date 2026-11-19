'use client'

import type { ReactNode } from 'react'
import { DirectionProvider } from '@langgenius/dify-ui/direction-provider'
import { dir } from 'i18next'
import { useLayoutEffect } from 'react'
import { useLocale } from '@/i18n/lib.client'

export function I18nDirectionProvider({
  children,
  syncDocument,
}: {
  children: ReactNode
  syncDocument: boolean
}) {
  const locale = useLocale()
  const direction = dir(locale)

  useLayoutEffect(() => {
    if (!syncDocument) return
    document.documentElement.lang = locale
    document.documentElement.dir = direction
  }, [direction, locale, syncDocument])

  return <DirectionProvider direction={direction}>{children}</DirectionProvider>
}
