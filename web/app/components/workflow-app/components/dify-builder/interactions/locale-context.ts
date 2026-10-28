import type { Locale } from '@/i18n'
import { createContext } from 'react'

export const DifyBuilderLocaleContext = createContext<Locale | null>(null)

export const DifyBuilderReplyLocaleContext = createContext<{
  readyLocales: ReadonlySet<Locale>
  preloadLocale: (locale: Locale) => () => void
} | null>(null)
