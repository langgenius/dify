import type { InitOptions } from 'i18next'
import { defaultNS, namespaces } from './resources'

export function getInitOptions(): InitOptions {
  return {
    // We do not have en for fallback
    load: 'currentOnly',
    fallbackLng: 'en-US',
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
