import type { InitOptions } from 'i18next'
import { defaultLocale } from './locale'
import { defaultNS, namespaces } from './resources'

export function getInitOptions(): InitOptions {
  return {
    // We do not have en for fallback
    load: 'currentOnly',
    fallbackLng: defaultLocale,
    partialBundledLanguages: true,
    defaultNS,
    enableSelector: 'optimize',
    keySeparator: false,
    ns: namespaces,
    interpolation: {
      escapeValue: false,
    },
  }
}
