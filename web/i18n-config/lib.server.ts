import type { Namespace } from './resources'
import { use } from 'react'
import { getLocaleOnServer, getTranslation } from './server'

async function getI18nConfig<T extends Namespace | undefined = undefined>(ns?: T) {
  const lang = await getLocaleOnServer()
  return getTranslation(lang, ns)
}

export function useTranslation<T extends Namespace | undefined = undefined>(ns?: T) {
  return use(getI18nConfig(ns))
}

export function useLocale() {
  return use(getLocaleOnServer())
}
