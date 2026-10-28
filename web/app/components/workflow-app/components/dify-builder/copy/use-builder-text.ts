import type { BuilderText } from './resolve-text'
import { use, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocale } from '#i18n'
import { resolveInteractionLocale } from '../interactions/locale'
import { DifyBuilderReplyLocaleContext } from '../interactions/locale-context'
import { useDifyBuilderInteractionLocale } from '../interactions/use-interaction-locale'
import { resolveBuilderText } from './resolve-text'

export const useBuilderText = (replyLanguage?: string) => {
  const sessionLocale = useDifyBuilderInteractionLocale()
  const accountLocale = useLocale()
  const replyLocales = use(DifyBuilderReplyLocaleContext)
  const requestedLocale = replyLanguage
    ? resolveInteractionLocale(replyLanguage, accountLocale)
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
