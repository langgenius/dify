import { defaultLocale, supportedLocales } from './locale'

export const i18n = { defaultLocale, locales: supportedLocales } as const

export type { Locale } from './locale'
