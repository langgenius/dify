import type { NamespaceCamelCase } from './i18next-config'
import { use } from 'react'
import { getLocaleOnServer, getTranslation } from './server'

async function getI18nConfig(ns?: NamespaceCamelCase) {
  const lang = await getLocaleOnServer()
  return getTranslation(lang, ns)
}

export function useTranslation(ns?: NamespaceCamelCase) {
  return use(getI18nConfig(ns))
}

export function useLocale() {
  return use(getLocaleOnServer())
}
