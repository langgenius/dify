import type { ResourceKey } from 'i18next'
import type { Locale } from './locale'
import type { Namespace, NamespaceInFileName } from './resources'
import { kebabCase } from 'es-toolkit/string'
import { defaultLocale, normalizeLocale } from './locale'

type LocaleResourceModule = {
  loadResource: (fileNamespace: string) => Promise<{ default: ResourceKey }>
}

const contactsLocalizedLocales = new Set<Locale>(['en-US', 'zh-Hans'])

const loadLocaleResources = (locale: string): Promise<LocaleResourceModule> => {
  const normalized = normalizeLocale(locale)
  return import(`./locale-resources/${normalized}.ts`)
}

export const loadI18nResource = async (
  locale: string,
  namespace: Namespace | NamespaceInFileName,
) => {
  const normalizedLocale = normalizeLocale(locale)
  const fileNamespace = kebabCase(namespace)
  const resourceLocale =
    fileNamespace === 'contacts' && !contactsLocalizedLocales.has(normalizedLocale)
      ? defaultLocale
      : normalizedLocale
  const { loadResource } = await loadLocaleResources(resourceLocale)
  return loadResource(fileNamespace)
}
