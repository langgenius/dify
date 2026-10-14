import type { BuilderText } from './resolve-text'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocale } from '#i18n'
import { resolveInteractionLocale } from '../interactions/locale'
import { useDifyBuilderInteractionLocale } from '../interactions/use-interaction-locale'
import { resolveBuilderText } from './resolve-text'

export const useBuilderText = (replyLanguage?: string) => {
  const accountLocale = useLocale()
  const sessionLocale = useDifyBuilderInteractionLocale()
  const locale = replyLanguage
    ? resolveInteractionLocale(replyLanguage, accountLocale)
    : sessionLocale
  const { t } = useTranslation(['difyBuilder'], { lng: locale })
  const renderText = useCallback(
    (text: BuilderText | null | undefined) => resolveBuilderText(text, t),
    [t],
  )
  return { locale, renderText }
}
