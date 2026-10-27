import type { ResourceKey } from 'i18next'
import type { Namespace, NamespaceInFileName } from './resources'
import { kebabCase } from 'es-toolkit/string'
import { normalizeLocale } from './locale'

type LocaleResourceModule = {
  loadResource: (fileNamespace: string) => Promise<{ default: ResourceKey }>
}

const loadLocaleResources = (locale: string): Promise<LocaleResourceModule> => {
  const normalized = normalizeLocale(locale)
  return import(`./locale-resources/${normalized}.ts`)
}

export const loadI18nResource = async (
  locale: string,
  namespace: Namespace | NamespaceInFileName,
) => {
  const { loadResource } = await loadLocaleResources(locale)
  return loadResource(kebabCase(namespace))
}
