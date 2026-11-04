import type { BuilderText } from './resolve-text'
import { use, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocale } from '#i18n'
import { resolveBuilderLocale } from './locale'
import { DifyBuilderReplyLocaleContext } from './locale-context'
import { resolveBuilderText } from './resolve-text'
import { useDifyBuilderLocale } from './use-builder-locale'

export const useBuilderText = (replyLanguage?: string) => {
  const sessionLocale = useDifyBuilderLocale()
  const accountLocale = useLocale()
  const replyLocales = use(DifyBuilderReplyLocaleContext)
  const requestedLocale = replyLanguage
    ? resolveBuilderLocale(replyLanguage, accountLocale)
    : undefined
  const preloadLocale = replyLocales?.preloadLocale
  useEffect(() => {
    if (requestedLocale && preloadLocale) return preloadLocale(requestedLocale)
  }, [preloadLocale, requestedLocale])
  const locale =
    requestedLocale && replyLocales?.readyLocales.has(requestedLocale)
      ? requestedLocale
      : sessionLocale
  const { t } = useTranslation(['difyBuilder'], { lng: locale })
  const renderText = useCallback(
    (text: BuilderText | null | undefined) => resolveBuilderText(text, t),
    [t],
  )
  return { locale, renderText }
}
