'use client'

import type { NamespaceCamelCase } from './resources'
import { useTranslation as useTranslationOriginal } from 'react-i18next'

export function useTranslation(): ReturnType<typeof useTranslationOriginal>
export function useTranslation<T extends NamespaceCamelCase>(
  ns: T,
): ReturnType<typeof useTranslationOriginal>
export function useTranslation(ns?: NamespaceCamelCase) {
  return useTranslationOriginal(ns)
}

export { useLocale } from '@/context/i18n'
