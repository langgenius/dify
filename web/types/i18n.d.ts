import type { NamespaceCamelCase, Resources } from '../i18n-config/i18next-config'
import 'i18next'

declare module 'i18next' {
  // eslint-disable-next-line ts/consistent-type-definitions
  interface CustomTypeOptions {
    defaultNS: 'common'
    resources: Resources
    keySeparator: false
  }
}

export type I18nKeysByPrefix<
  NS extends NamespaceCamelCase,
  Prefix extends string = '',
> = keyof Resources[NS] extends infer K
  ? K extends `${Prefix}${infer Rest}`
    ? Rest
    : never
  : never

export type I18nKeysWithPrefix<
  NS extends NamespaceCamelCase,
  Prefix extends string = '',
> = Extract<keyof Resources[NS], `${Prefix}${string}`>
