import type { NamespaceCamelCase } from './i18next-config'
import type { Arrayable } from '@/utils/type'
import { use } from 'react'
import { getLocaleOnServer, getTranslation } from './server'

async function getI18nConfig(ns?: Arrayable<NamespaceCamelCase>) {
  const lang = await getLocaleOnServer()
  return getTranslation(lang, ns)
}

export function useTranslation(ns?: Arrayable<NamespaceCamelCase>) {
  return use(getI18nConfig(ns))
}

export function useLocale() {
  return use(getLocaleOnServer())
}
