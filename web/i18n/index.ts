import { LanguagesSupported } from '@/utils/language'

export const i18n = {
  defaultLocale: 'en',
  locales: LanguagesSupported,
} as const

export type Locale = typeof i18n['locales'][number]
