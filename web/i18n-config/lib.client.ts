'use client'

import type { Namespace } from './resources'
import { useTranslation as useTranslationOriginal } from 'react-i18next'

export function useTranslation<T extends Namespace | undefined = undefined>(ns?: T) {
  return useTranslationOriginal(ns)
}

export { useLocale } from '@/context/i18n'
