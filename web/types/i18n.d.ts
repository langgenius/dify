import type { namespaces } from '../i18n-config/i18next-config'
import 'i18next'

declare module 'i18next' {
  // eslint-disable-next-line ts/consistent-type-definitions
  interface CustomTypeOptions {
    defaultNS: 'common'
    resources: typeof namespaces
    keySeparator: false
  }
}
