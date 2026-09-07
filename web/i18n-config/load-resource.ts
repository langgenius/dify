import type { ResourceKey } from 'i18next'
import type { Locale } from './language'
import type { Namespace, NamespaceInFileName } from './resources'
import { kebabCase } from 'es-toolkit/string'
import { LanguagesSupported } from './language'

type LocaleResourceModule = {
  loadResource: (fileNamespace: string) => Promise<{ default: ResourceKey }>
}

const legacyLocaleMap: Partial<Record<Locale, Locale>> = {
  en_US: 'en-US',
  ja_JP: 'ja-JP',
  zh_Hans: 'zh-Hans',
}

const defaultLocale = 'en-US' satisfies Locale

const normalizeLocale = (locale: Locale): Locale => {
  const normalized = legacyLocaleMap[locale] ?? locale
  if (LanguagesSupported.includes(normalized)) return normalized

  return defaultLocale
}

const loadLocaleResources = (locale: Locale): Promise<LocaleResourceModule> => {
  const normalized = normalizeLocale(locale)
  return import(`./locale-resources/${normalized}.ts`)
}

export const loadI18nResource = async (
  locale: Locale,
  namespace: Namespace | NamespaceInFileName,
) => {
  const { loadResource } = await loadLocaleResources(locale)
  return loadResource(kebabCase(namespace))
}
