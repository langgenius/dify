import type { InitOptions } from 'i18next'
import type { Namespace } from './resources'
import { defaultLocale } from './locale'
import { defaultNS, namespaces } from './resources'

export function getInitOptions(requiredNamespaces: readonly Namespace[] = namespaces): InitOptions {
  return {
    // We do not have en for fallback
    load: 'currentOnly',
    fallbackLng: defaultLocale,
    partialBundledLanguages: true,
    defaultNS: requiredNamespaces.includes(defaultNS) ? defaultNS : 'common',
    enableSelector: 'optimize',
    keySeparator: false,
    ns: [...requiredNamespaces],
    interpolation: {
      escapeValue: false,
    },
  }
}
