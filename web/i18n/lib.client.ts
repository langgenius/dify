'use client'

import type { Locale } from './locale'
import type { Namespace } from './resources'
import { useTranslation as useTranslationOriginal } from 'react-i18next'

export function useTranslation<T extends Namespace | undefined = undefined>(ns?: T) {
  return useTranslationOriginal(ns)
}

export function useLocale(): Locale {
  const { i18n } = useTranslationOriginal()
  return i18n.language as Locale
}
