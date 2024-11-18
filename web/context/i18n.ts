import type { Locale } from '@/i18n'
import { getLanguage } from '@/i18n/language'
import { createSelectorCtx } from '@/utils/context'

type II18NContext = {
  locale: Locale
  i18n: Record<string, any>
  setLocaleOnClient: (_lang: Locale, _reloadPage?: boolean) => void
}

const [, useI18N, I18NContext] = createSelectorCtx<II18NContext>()

export { useI18N }
export const useGetLanguage = () => {
  const { locale } = useI18N()

  return getLanguage(locale)
}

export default I18NContext
