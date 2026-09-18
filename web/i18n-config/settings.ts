import type { InitOptions } from 'i18next'
import type { Namespace } from './resources'
import { defaultLocale } from './locale'
import { defaultNS, namespaces } from './resources'

type GetInitOptionsParams = {
  namespaces?: readonly Namespace[]
}

export function getInitOptions(params?: GetInitOptionsParams): InitOptions {
  const activeNamespaces = params?.namespaces ?? namespaces

  return {
    // We do not have en for fallback
    load: 'currentOnly',
    fallbackLng: defaultLocale,
    partialBundledLanguages: true,
    defaultNS,
    enableSelector: 'optimize',
    keySeparator: false,
    ns: [...activeNamespaces],
    interpolation: {
      escapeValue: false,
    },
  }
}
