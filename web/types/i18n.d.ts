import type { Namespace, Resources } from '../i18n-config/resources'
import 'i18next'

declare module 'i18next' {
  // eslint-disable-next-line ts/consistent-type-definitions
  interface CustomTypeOptions {
    resources: Resources
    keySeparator: false
  }
}

export type I18nKeysByPrefix<
  NS extends Namespace,
  Prefix extends string = '',
> = Prefix extends ''
  ? keyof Resources[NS]
  : keyof Resources[NS] extends infer K
    ? K extends `${Prefix}${infer Rest}`
      ? Rest
      : never
    : never

export type I18nKeysWithPrefix<
  NS extends Namespace,
  Prefix extends string = '',
> = Prefix extends ''
  ? keyof Resources[NS]
  : Extract<keyof Resources[NS], `${Prefix}${string}`>
