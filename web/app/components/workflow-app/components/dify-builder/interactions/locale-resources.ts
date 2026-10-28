import type { i18n } from 'i18next'
import type { Locale } from '@/i18n'
import type { Namespace } from '@/i18n/resources'

export const hasLocaleResources = (
  instance: i18n,
  locale: Locale,
  namespaces: readonly Namespace[],
) => namespaces.every((namespace) => instance.hasResourceBundle(locale, namespace))

export const loadLocaleResources = async (
  instance: i18n,
  locale: Locale,
  namespaces: readonly Namespace[],
) => {
  const missingNamespaces = namespaces.filter(
    (namespace) => !instance.hasResourceBundle(locale, namespace),
  )
  // Restrict the load to missing pairs; loadLanguages can wait for older language requests.
  if (missingNamespaces.length) await instance.reloadResources([locale], missingNamespaces)
  // i18next resolves loading promises on failure too. Commit only actual resource bundles.
  return hasLocaleResources(instance, locale, namespaces)
}
