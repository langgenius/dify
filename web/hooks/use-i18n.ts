import { useLanguage } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { renderI18nObject } from '@/i18n-config'

export const useRenderI18nObject = () => {
  const language = useLanguage()
  return (obj: Record<string, string>) => {
    return renderI18nObject(obj, language)
  }
}
