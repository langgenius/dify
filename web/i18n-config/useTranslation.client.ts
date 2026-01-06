'use client'

import type { NamespaceCamelCase } from './i18next-config'
import type { Arrayable } from '@/utils/type'
import { useTranslation as useTranslationOriginal } from 'react-i18next'

export function useTranslation(ns?: Arrayable<NamespaceCamelCase>) {
  return useTranslationOriginal(ns)
}
