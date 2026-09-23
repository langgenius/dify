'use client'

import type { Locale } from './locale'
import type { Namespace } from './resources'
import { useTranslation as useTranslationOriginal } from 'react-i18next'

export function useTranslation<
  const T extends readonly [Namespace, ...Namespace[]] | undefined = undefined,
>(ns?: T) {
  // oxlint-disable-next-line dify/require-i18n-namespace -- Forward the typed tuple while preserving the omitted namespace for locale-only callers.
  return useTranslationOriginal(ns)
}

export function useLocale(): Locale {
  const { i18n } = useTranslationOriginal()
  return i18n.language as Locale
}
