import type { messagesEN } from '../i18n-config/i18next-config'
import 'react-i18next'

// Complete type structure that matches i18next-config.ts camelCase conversion
export type Messages = typeof messagesEN

// Utility type to flatten nested object keys into dot notation
type FlattenKeys<T> = T extends object
  ? {
      [K in keyof T]: T[K] extends object
        ? `${K & string}.${FlattenKeys<T[K]> & string}`
        : `${K & string}`
    }[keyof T]
  : never

export type ValidTranslationKeys = FlattenKeys<Messages>

declare module 'i18next' {
  // eslint-disable-next-line ts/consistent-type-definitions
  interface CustomTypeOptions {
    defaultNS: 'translation'
    resources: {
      translation: Messages
    }
  }
}
