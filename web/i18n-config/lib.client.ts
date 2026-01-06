'use client'

import type { NamespaceCamelCase } from './i18next-config'
import { useTranslation as useTranslationOriginal } from 'react-i18next'

export function useTranslation(ns?: NamespaceCamelCase) {
  return useTranslationOriginal(ns)
}

export { useLocale } from '@/context/i18n'
