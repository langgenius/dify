import type { InitOptions } from 'i18next'
import { namespacesCamelCase } from './resources'

export function getInitOptions(): InitOptions {
  return {
    // We do not have en for fallback
    load: 'currentOnly',
    fallbackLng: 'en-US',
    partialBundledLanguages: true,
    keySeparator: false,
    ns: namespacesCamelCase,
    interpolation: {
      escapeValue: false,
    },
  }
}
