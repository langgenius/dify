import type { ReactNode } from 'react'
import type { Locale } from '@/i18n'
import { useAtomValue } from 'jotai'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocale } from '#i18n'
import { supportedLocales } from '@/i18n/locale'
import { difyBuilderExecutionProgressAtom, difyBuilderReplyLanguageAtom } from '../session/state'
import { resolveInteractionLocale } from './locale'
import { DifyBuilderLocaleContext, DifyBuilderReplyLocaleContext } from './locale-context'
import { hasLocaleResources, loadLocaleResources } from './locale-resources'

const PANEL_NAMESPACES = ['common', 'difyBuilder'] as const

export const DifyBuilderLocaleProvider = ({ children }: { children: ReactNode }) => {
  const { i18n } = useTranslation(['common'], { useSuspense: false })
  const accountLocale = useLocale()
  const replyLanguage = useAtomValue(difyBuilderReplyLanguageAtom)
  const progress = useAtomValue(difyBuilderExecutionProgressAtom)
  const requestedLocale = resolveInteractionLocale(
    progress?.replyLanguage || replyLanguage,
    accountLocale,
  )
  const [displayLocale, setDisplayLocale] = useState(() =>
    hasLocaleResources(i18n, requestedLocale, PANEL_NAMESPACES) ? requestedLocale : accountLocale,
  )
  const [readyReplyLocales, setReadyReplyLocales] = useState<ReadonlySet<Locale>>(
    () =>
      new Set(supportedLocales.filter((locale) => i18n.hasResourceBundle(locale, 'difyBuilder'))),
  )

  useEffect(() => {
    let cancelled = false
    void loadLocaleResources(i18n, requestedLocale, PANEL_NAMESPACES).then((loaded) => {
      if (cancelled || !loaded) return
      setDisplayLocale(requestedLocale)
      setReadyReplyLocales((current) =>
        current.has(requestedLocale) ? current : new Set([...current, requestedLocale]),
      )
    })
    return () => {
      cancelled = true
    }
  }, [i18n, requestedLocale])

  const preloadReplyLocale = useCallback(
    (locale: Locale) => {
      let cancelled = false
      void loadLocaleResources(i18n, locale, ['difyBuilder']).then((loaded) => {
        if (cancelled || !loaded) return
        setReadyReplyLocales((current) =>
          current.has(locale) ? current : new Set([...current, locale]),
        )
      })
      return () => {
        cancelled = true
      }
    },
    [i18n],
  )
  const replyLocales = useMemo(
    () => ({
      readyLocales: readyReplyLocales,
      preloadLocale: preloadReplyLocale,
    }),
    [preloadReplyLocale, readyReplyLocales],
  )

  return (
    <DifyBuilderLocaleContext value={displayLocale}>
      <DifyBuilderReplyLocaleContext value={replyLocales}>{children}</DifyBuilderReplyLocaleContext>
    </DifyBuilderLocaleContext>
  )
}
