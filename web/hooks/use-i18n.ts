import { useLocale } from '#i18n'
import { getModelLanguage, renderI18nObject } from '@/i18n/metadata'

export const useRenderI18nObject = () => {
  const language = getModelLanguage(useLocale())
  return (obj: Parameters<typeof renderI18nObject>[0]) => renderI18nObject(obj, language)
}
